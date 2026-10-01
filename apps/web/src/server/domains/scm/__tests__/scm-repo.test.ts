/** SCM-001 单测：绑定 CRUD（上限/重复/首个默认/认证校验）/ 默认互斥与删除补位 / verify 状态机（凭据失效/平台矩阵/元信息刷新）。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError, ErrCode } from "@rabbit/shared";
import { encryptCredential } from "@/server/domains/api/credential-crypto";

const SECRET = process.env.SCM_UNIT_SECRET ?? "s".repeat(32);
const TOK = `${SECRET}:pat`;

vi.mock("@/server/safe-fetch", () => ({ outboundDispatcher: () => ({}) }));
vi.mock("@/server/domains/api/outbound-guard", () => ({
  // SSRF：对标记 host 抛守卫错误（其余放行——单测不出网，fetch 有 stub）
  assertSafeOutboundUrl: vi.fn(async (url: string) => {
    if (url.startsWith("http://169.254")) {
      const { DomainError: DE, ErrCode: EC } = await import("@rabbit/shared");
      throw new DE(EC.SWAGGER_SYNC_URL_BLOCKED, "blocked");
    }
  }),
}));

vi.mock("@rabbit/db", () => {
  return {
    prisma: {
      scmRepository: {
        count: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      scmAccount: { findFirst: vi.fn(), findUnique: vi.fn() },
      $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
    },
  };
});

import { prisma } from "@rabbit/db";
import { createScmRepo, updateScmRepo, deleteScmRepo, verifyScmRepo } from "../scm-repo.service";

const repoRow = (over: Record<string, unknown> = {}) => ({
  id: "repo-1",
  projectId: "p1",
  name: null,
  provider: "gitea",
  repoUrl: "https://git.rabbit.inner/qa/demo.git",
  sshUrl: null,
  host: "git.rabbit.inner",
  owner: "qa",
  repo: "demo",
  apiBase: "https://git.rabbit.inner/api/v1",
  authType: "token",
  accountId: null,
  username: null,
  secretEnc: encryptCredential("scm-repo:gitea", TOK),
  defaultBranch: null,
  visibility: null,
  isDefault: true,
  verifyStatus: "UNVERIFIED",
  verifyMessage: null,
  lastVerifiedAt: null,
  createdById: "u1",
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RABBIT_INTEGRATION_SECRET = SECRET;
  vi.mocked(prisma.scmRepository.findFirst).mockResolvedValue(null);
  // create mock：返回带时间字段的完整行（serialize 需要 Date）
  vi.mocked(prisma.scmRepository.create).mockImplementation((async (args: unknown) => {
    const row = {
      ...(args as { data: Record<string, unknown> }).data,
      id: "repo-new",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return row;
  }) as never);
});
afterEach(() => {
  delete process.env.RABBIT_INTEGRATION_SECRET;
});

describe("createScmRepo", () => {
  it("URL 直填（gitea + token）：解析+加密落库，首个绑定自动默认", async () => {
    vi.mocked(prisma.scmRepository.count).mockResolvedValue(0);
    const r = await createScmRepo("org-1", "p1", "u1", {
      source: "url",
      provider: "gitea",
      repoUrl: "https://git.rabbit.inner/qa/demo.git",
      authType: "token",
      token: TOK,
    });
    const data = vi.mocked(prisma.scmRepository.create).mock.calls[0]![0].data as Record<
      string,
      unknown
    >;
    expect(data).toMatchObject({
      host: "git.rabbit.inner",
      owner: "qa",
      repo: "demo",
      isDefault: true,
    });
    expect(data.secretEnc).not.toBe(TOK); // 密文
    expect(r.provider).toBe("gitea");
  });

  it("ssh 地址（gitlab）：仅解析不出站，host/owner/repo 归一", async () => {
    vi.mocked(prisma.scmRepository.count).mockResolvedValue(1);
    await createScmRepo("org-1", "p1", "u1", {
      source: "url",
      provider: "gitlab",
      repoUrl: "git@git.rabbit.inner:backend/order-service.git",
      authType: "none",
    });
    const data = vi.mocked(prisma.scmRepository.create).mock.calls[0]![0].data as Record<
      string,
      unknown
    >;
    expect(data).toMatchObject({
      host: "git.rabbit.inner",
      owner: "backend",
      repo: "order-service",
    });
  });

  it("OAuth 来源：按账号平台拼官方 https 地址并挂 accountId", async () => {
    vi.mocked(prisma.scmRepository.count).mockResolvedValue(0);
    vi.mocked(prisma.scmAccount.findFirst).mockResolvedValue({
      id: "acc-1",
      orgId: "org-1",
      provider: "github",
      baseUrl: null,
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.scmAccount.findUnique).mockResolvedValue({ login: "xujialiang" } as never);
    await createScmRepo("org-1", "p1", "u1", {
      source: "oauth",
      accountId: "acc-1",
      owner: "RabbitAI-Lab",
      repo: "rabbit-web",
    });
    const data = vi.mocked(prisma.scmRepository.create).mock.calls[0]![0].data as Record<
      string,
      unknown
    >;
    expect(data.repoUrl).toBe("https://github.com/RabbitAI-Lab/rabbit-web.git");
    expect(data).toMatchObject({
      authType: "oauth",
      accountId: "acc-1",
      apiBase: "https://api.github.com",
    });
  });

  it("重复绑定（同 host/owner/repo）→ 20422", async () => {
    vi.mocked(prisma.scmRepository.count).mockResolvedValue(1);
    vi.mocked(prisma.scmRepository.findFirst).mockResolvedValue({ id: "dup" } as never);
    await expect(
      createScmRepo("org-1", "p1", "u1", {
        source: "url",
        provider: "gitea",
        repoUrl: "https://git.rabbit.inner/qa/demo.git",
        authType: "none",
      }),
    ).rejects.toMatchObject({ code: ErrCode.VALIDATION_FAILED });
  });

  it("超上限（10/项目）→ 40475", async () => {
    vi.mocked(prisma.scmRepository.count).mockResolvedValue(10);
    await expect(
      createScmRepo("org-1", "p1", "u1", {
        source: "url",
        provider: "gitea",
        repoUrl: "https://git.rabbit.inner/qa/demo.git",
        authType: "none",
      }),
    ).rejects.toMatchObject({ code: ErrCode.SCM_REPO_LIMIT_EXCEEDED });
  });

  it("SSRF 拦截（元数据地址）→ 40477", async () => {
    vi.mocked(prisma.scmRepository.count).mockResolvedValue(0);
    await expect(
      createScmRepo("org-1", "p1", "u1", {
        source: "url",
        provider: "gitea",
        repoUrl: "http://169.254.169.254/qa/demo.git",
        authType: "none",
      }),
    ).rejects.toMatchObject({ code: ErrCode.SCM_REPO_URL_BLOCKED });
  });

  it("password 缺用户名/密码 → 20422；token 缺令牌 → 20422", async () => {
    vi.mocked(prisma.scmRepository.count).mockResolvedValue(0);
    await expect(
      createScmRepo("org-1", "p1", "u1", {
        source: "url",
        provider: "gitea",
        repoUrl: "https://git.rabbit.inner/qa/demo.git",
        authType: "password",
        password: "x",
      }),
    ).rejects.toMatchObject({ code: ErrCode.VALIDATION_FAILED });
    await expect(
      createScmRepo("org-1", "p1", "u1", {
        source: "url",
        provider: "gitea",
        repoUrl: "https://git.rabbit.inner/qa/demo.git",
        authType: "token",
      }),
    ).rejects.toMatchObject({ code: ErrCode.VALIDATION_FAILED });
  });
});

describe("updateScmRepo / deleteScmRepo（默认互斥与补位）", () => {
  it("设默认：事务内先清后立", async () => {
    vi.mocked(prisma.scmRepository.findFirst).mockResolvedValue(
      repoRow({ isDefault: false }) as never,
    );
    vi.mocked(prisma.scmRepository.update).mockResolvedValue(repoRow({ isDefault: true }) as never);
    await updateScmRepo("p1", "repo-1", { isDefault: true });
    expect(prisma.scmRepository.updateMany).toHaveBeenCalledWith({
      where: { projectId: "p1" },
      data: { isDefault: false },
    });
    expect(prisma.scmRepository.update).toHaveBeenCalledWith({
      where: { id: "repo-1" },
      data: { isDefault: true },
    });
  });

  it("删除默认仓库 → 剩余最早一条补位", async () => {
    vi.mocked(prisma.scmRepository.findFirst)
      .mockResolvedValueOnce(repoRow() as never)
      .mockResolvedValueOnce({ id: "repo-2" } as never);
    vi.mocked(prisma.scmRepository.update).mockResolvedValue({} as never);
    await deleteScmRepo("p1", "repo-1");
    const calls = vi.mocked(prisma.scmRepository.update).mock.calls;
    expect(calls[0]![0].where).toEqual({ id: "repo-1" }); // 软删
    expect(calls[1]![0]).toEqual({ where: { id: "repo-2" }, data: { isDefault: true } }); // 补位
  });
});

describe("verifyScmRepo（状态机）", () => {
  const fetchRoutes: { match: (u: string) => boolean; respond: () => Response }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      const route = fetchRoutes.find((r) => r.match(u));
      if (route) return route.respond();
      return new Response("{}", { status: 404 });
    }),
  );

  it("OK：探活+元信息刷新（defaultBranch/visibility/lastVerifiedAt 持久化）", async () => {
    fetchRoutes.length = 0;
    vi.mocked(prisma.scmRepository.findFirst).mockResolvedValue(repoRow() as never);
    vi.mocked(prisma.scmRepository.update).mockResolvedValue(repoRow() as never);
    fetchRoutes.push(
      {
        match: (u) => u.endsWith("/repos/qa/demo"),
        respond: () =>
          new Response(JSON.stringify({ default_branch: "main", private: true }), { status: 200 }),
      },
      {
        match: (u) => u.includes("/commits"),
        respond: () =>
          new Response(
            JSON.stringify([
              {
                sha: "abc",
                commit: { message: "feat: x", author: { date: "2026-10-01T00:00:00Z" } },
              },
            ]),
            { status: 200 },
          ),
      },
    );
    const r = await verifyScmRepo("org-1", "p1", "repo-1");
    expect(r.status).toBe("OK");
    expect(r.defaultBranch).toBe("main");
    expect(r.latestCommit?.sha).toBe("abc");
    const data = vi.mocked(prisma.scmRepository.update).mock.calls[0]![0].data as Record<
      string,
      unknown
    >;
    expect(data).toMatchObject({
      verifyStatus: "OK",
      defaultBranch: "main",
      visibility: "private",
    });
  });

  it("401/403 → INVALID_CRED 持久化并抛 SCM_VERIFY_FAILED", async () => {
    fetchRoutes.length = 0;
    vi.mocked(prisma.scmRepository.findFirst).mockResolvedValue(repoRow() as never);
    vi.mocked(prisma.scmRepository.update).mockResolvedValue(repoRow() as never);
    fetchRoutes.push({
      match: () => true,
      respond: () => new Response("{}", { status: 401 }),
    });
    await expect(verifyScmRepo("org-1", "p1", "repo-1")).rejects.toMatchObject({
      code: ErrCode.SCM_VERIFY_FAILED,
    });
    const data = vi.mocked(prisma.scmRepository.update).mock.calls[0]![0].data as Record<
      string,
      unknown
    >;
    expect(data.verifyStatus).toBe("INVALID_CRED");
  });

  it("github + 账密 → FAILED（平台能力矩阵，不出站）", async () => {
    fetchRoutes.length = 0;
    vi.mocked(prisma.scmRepository.findFirst).mockResolvedValue(
      repoRow({
        provider: "github",
        apiBase: "https://api.github.com",
        host: "github.com",
        authType: "password",
        username: "qa-bot",
      }) as never,
    );
    vi.mocked(prisma.scmRepository.update).mockResolvedValue({} as never);
    await expect(verifyScmRepo("org-1", "p1", "repo-1")).rejects.toMatchObject({
      code: ErrCode.SCM_VERIFY_FAILED,
    });
    const data = vi.mocked(prisma.scmRepository.update).mock.calls[0]![0].data as Record<
      string,
      unknown
    >;
    expect(data.verifyStatus).toBe("FAILED");
    expect(String(data.verifyMessage)).toContain("不支持账号密码");
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it("custom 平台 → 仅保存不验证", async () => {
    vi.mocked(prisma.scmRepository.findFirst).mockResolvedValue(
      repoRow({ provider: "custom", apiBase: null }) as never,
    );
    vi.mocked(prisma.scmRepository.update).mockResolvedValue({} as never);
    await expect(verifyScmRepo("org-1", "p1", "repo-1")).rejects.toMatchObject({
      code: ErrCode.SCM_VERIFY_FAILED,
    });
  });

  it("OAuth 凭据装配：账号已撤销 → 40478", async () => {
    vi.mocked(prisma.scmRepository.findFirst).mockResolvedValue(
      repoRow({ authType: "oauth", accountId: "acc-9" }) as never,
    );
    vi.mocked(prisma.scmAccount.findFirst).mockResolvedValue(repoRowDeletedAccount() as never);
    await expect(verifyScmRepo("org-1", "p1", "repo-1")).rejects.toMatchObject({
      code: ErrCode.SCM_ACCOUNT_NOT_FOUND,
    });
  });
});

function repoRowDeletedAccount() {
  return { id: "acc-9", orgId: "org-1", status: "REVOKED" };
}
