/** SCM-001 单测（真实 SSRF 守卫链路）：jm/e2e 栈开 OUTBOUND_ALLOW_PRIVATE=1 时 40477 场景无法在栈上触发，
 *  此处以真实 outbound-guard 验证 元数据/环回 地址 → 服务层映射 SCM_REPO_URL_BLOCKED（40477）。
 *  guard 对字面 IP 无 DNS 出网；本文件不 mock outbound-guard。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrCode } from "@rabbit/shared";

const SECRET = process.env.SCM_UNIT_SECRET ?? "s".repeat(32);

vi.mock("@/server/safe-fetch", () => ({ outboundDispatcher: () => ({}) }));
vi.mock("@rabbit/db", () => {
  return {
    prisma: {
      scmRepository: { count: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
      scmAccount: { findFirst: vi.fn(), findUnique: vi.fn() },
    },
  };
});

import { prisma } from "@rabbit/db";
import { createScmRepo } from "../scm-repo.service";

describe("SSRF 真实守卫（无 mock：assertSafeOutboundUrl 实链路）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RABBIT_INTEGRATION_SECRET = SECRET;
    delete process.env.OUTBOUND_ALLOW_PRIVATE;
    vi.mocked(prisma.scmRepository.count).mockResolvedValue(0);
    vi.mocked(prisma.scmRepository.findFirst).mockResolvedValue(null);
  });
  afterEach(() => {
    delete process.env.RABBIT_INTEGRATION_SECRET;
  });

  it("元数据地址 169.254.169.254 → 40477 SCM_REPO_URL_BLOCKED", async () => {
    await expect(
      createScmRepo("org-1", "p1", "u1", {
        source: "url",
        provider: "gitea",
        repoUrl: "http://169.254.169.254/qa/demo.git",
        authType: "none",
      }),
    ).rejects.toMatchObject({ code: ErrCode.SCM_REPO_URL_BLOCKED });
  });

  it("环回地址 127.0.0.1 → 40477（生产口径默认拦截）", async () => {
    await expect(
      createScmRepo("org-1", "p1", "u1", {
        source: "url",
        provider: "gitea",
        repoUrl: "http://127.0.0.1:9/qa/demo.git",
        authType: "none",
      }),
    ).rejects.toMatchObject({ code: ErrCode.SCM_REPO_URL_BLOCKED });
  });
});
