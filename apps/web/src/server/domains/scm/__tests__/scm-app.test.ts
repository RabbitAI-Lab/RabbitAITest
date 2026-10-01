/** SCM-001 单测：resolveScmBases 端点基址（纯函数）+ resolveScmApp 双层继承 + 组织覆盖保存语义。
 *  凭据字面量零硬编码（Mimosa 约束）：测试值一律从 env 读或由测试密钥 env 派生。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveScmBases } from "@rabbit/shared";
import { encryptCredential, decryptCredential } from "@/server/domains/api/credential-crypto";

const SECRET = process.env.SCM_UNIT_SECRET ?? "s".repeat(32);
// 测试凭据值：由测试密钥派生（非可用凭据，源码零字面量）
const CRED_ORG = `${SECRET}:org`;
const CRED_NEW = `${SECRET}:new`;
const CRED_KEPT = `${SECRET}:kept`;

const ORG_APP = { orgId: "org-1", clientId: "", clientSecret: "", baseUrl: "", enabled: true };

vi.mock("@rabbit/db", () => {
  return {
    prisma: {
      scmOrgApp: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        deleteMany: vi.fn(),
      },
      systemParam: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
    },
  };
});

import { prisma } from "@rabbit/db";
import { resolveScmApp, upsertScmOrgApp } from "../scm-app.service";

const orgAppRow = (over: Partial<typeof ORG_APP> = {}) => ({ ...ORG_APP, ...over });

describe("resolveScmBases（shared 纯函数：env 覆盖 > GitLab 实例 > 官方域）", () => {
  it("默认官方域（github web/api 分域）", () => {
    expect(resolveScmBases("github", {})).toEqual({
      webBase: "https://github.com",
      apiBase: "https://api.github.com",
    });
    expect(resolveScmBases("gitee", {})).toEqual({
      webBase: "https://gitee.com",
      apiBase: "https://gitee.com/api/v5",
    });
  });

  it("GitLab：appBaseUrl（自建实例）优先于默认 gitlab.com", () => {
    expect(resolveScmBases("gitlab", { appBaseUrl: "https://git.rabbit.inner" })).toEqual({
      webBase: "https://git.rabbit.inner",
      apiBase: "https://git.rabbit.inner/api/v4",
    });
    expect(resolveScmBases("gitlab", {})).toEqual({
      webBase: "https://gitlab.com",
      apiBase: "https://gitlab.com/api/v4",
    });
  });

  it("env 覆盖（测试栈指向 mock）：web+api 同域且尾斜杠归一", () => {
    expect(
      resolveScmBases("github", { envBase: "http://127.0.0.1:4106/mock-scm/github/" }),
    ).toEqual({
      webBase: "http://127.0.0.1:4106/mock-scm/github",
      apiBase: "http://127.0.0.1:4106/mock-scm/github",
    });
  });
});

describe("resolveScmApp（双层继承）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RABBIT_INTEGRATION_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.RABBIT_INTEGRATION_SECRET;
  });

  it("组织覆盖命中（enabled 且有 clientId）→ source=org，密文可解", async () => {
    vi.mocked(prisma.scmOrgApp.findUnique).mockResolvedValue(
      orgAppRow({
        clientId: "org-client",
        clientSecret: encryptCredential("scm-app:github", CRED_ORG),
      }) as never,
    );
    const r = await resolveScmApp("org-1", "github");
    expect(r).toMatchObject({ source: "org", clientId: "org-client", clientSecret: CRED_ORG });
  });

  it("组织覆盖未启用 → 回落系统级", async () => {
    vi.mocked(prisma.scmOrgApp.findUnique).mockResolvedValue(
      orgAppRow({ enabled: false, clientId: "org-client" }) as never,
    );
    vi.mocked(prisma.systemParam.findUnique).mockResolvedValue({
      value: { github: { clientId: "sys-client", clientSecret: "enc:stub", enabled: true } },
    } as never);
    // param.service decryptSecret 用 config.sessionSecret；stub 密文不可解 → 回退原串（视为已脱敏口径）
    const r = await resolveScmApp("org-1", "github");
    expect(r.source).toBe("system");
    expect(r.clientId).toBe("sys-client");
  });

  it("均无配置 → source=none", async () => {
    vi.mocked(prisma.scmOrgApp.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.systemParam.findUnique).mockResolvedValue({
      value: { github: { clientId: "", enabled: false } },
    } as never);
    const r = await resolveScmApp("org-1", "github");
    expect(r.source).toBe("none");
    expect(r.clientId).toBe("");
  });
});

describe("upsertScmOrgApp（覆盖保存语义）", () => {
  beforeEach(() => {
    process.env.RABBIT_INTEGRATION_SECRET = SECRET;
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete process.env.RABBIT_INTEGRATION_SECRET;
  });

  it("带新 secret → 加密落库（密文非明文，可解回）", async () => {
    vi.mocked(prisma.scmOrgApp.upsert).mockResolvedValue({ clientSecret: "x" } as never);
    await upsertScmOrgApp("org-1", "github", {
      clientId: "c1",
      clientSecret: CRED_NEW,
      enabled: true,
    });
    const arg = vi.mocked(prisma.scmOrgApp.upsert).mock.calls[0]![0];
    const secret = (arg.create as unknown as Record<string, string>).clientSecret!;
    expect(secret).not.toBe(CRED_NEW);
    expect(decryptCredential("scm-app:github", secret)).toBe(CRED_NEW);
  });

  it("secret 留空/****** → 沿用已存密文", async () => {
    // 加密随机 IV：同明文两次加密密文不同——断言须比对已存密文串本身
    const keptEnc = encryptCredential("scm-app:github", CRED_KEPT);
    vi.mocked(prisma.scmOrgApp.findUnique).mockResolvedValue(
      orgAppRow({ clientSecret: keptEnc }) as never,
    );
    vi.mocked(prisma.scmOrgApp.upsert).mockResolvedValue({ clientSecret: "x" } as never);
    await upsertScmOrgApp("org-1", "github", { clientId: "c1", enabled: true });
    const arg = vi.mocked(prisma.scmOrgApp.upsert).mock.calls[0]![0];
    expect((arg.create as unknown as Record<string, string>).clientSecret).toBe(keptEnc);
  });
});
