/** SCM-001 单测：state 一次性消费 / authorize URL / callback 换 token→账号 upsert / 选仓归一 / GitLab 刷新。
 *  出站全部走 fetch stub（SCM_*_BASE_URL 指向 mock 域）；凭据值由测试密钥派生零字面量。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError, ErrCode } from "@rabbit/shared";
import { encryptCredential } from "@/server/domains/api/credential-crypto";

const SECRET = process.env.SCM_UNIT_SECRET ?? "s".repeat(32);
const TOK = `${SECRET}:at`;
const REFRESH = `${SECRET}:rt`;
const MOCK_GH = "http://127.0.0.1:4106/mock-scm/github";
const MOCK_GL = "http://127.0.0.1:4106/mock-scm/gitlab";

// redis mock（state 存储：一次性消费语义靠 get→del）
vi.mock("@/server/redis", () => {
  const store = new Map<string, string>();
  return {
    redis: () => ({
      set: vi.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      del: vi.fn(async (k: string) => {
        store.delete(k);
      }),
    }),
    __stateStore: store,
  };
});

vi.mock("@/server/safe-fetch", () => ({ outboundDispatcher: () => ({}) }));
vi.mock("@/server/domains/api/outbound-guard", () => ({
  assertSafeOutboundUrl: vi.fn(async () => {}),
}));

vi.mock("@rabbit/db", () => {
  return {
    prisma: {
      scmOrgApp: { findUnique: vi.fn() },
      systemParam: { findUnique: vi.fn() },
      scmAccount: { upsert: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    },
  };
});

import { prisma } from "@rabbit/db";
import {
  issueScmState,
  consumeScmState,
  buildScmAuthorizeUrl,
  handleScmCallback,
  listAccountRepos,
  accountToken,
} from "../scm-oauth.service";

// 全局 fetch stub：按 URL 匹配
const routes: { match: (url: string, init?: RequestInit) => boolean; respond: () => Response }[] =
  [];
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    const route = routes.find((r) => r.match(u, init));
    if (route) return route.respond();
    return new Response("{}", { status: 404 });
  }),
);
const addRoute = (match: (u: string, init?: RequestInit) => boolean, respond: () => Response) => {
  routes.unshift({ match, respond });
};

const orgApp = (provider: string) => ({
  orgId: "org-1",
  provider,
  clientId: `client-${provider}`,
  clientSecret: encryptCredential(`scm-app:${provider}`, `${SECRET}:cs`),
  baseUrl: "",
  enabled: true,
});

const accountRow = (over: Record<string, unknown> = {}) => ({
  id: "acc-1",
  orgId: "org-1",
  userId: "user-1",
  provider: "github",
  baseUrl: null,
  tokenEnc: encryptCredential("scm-account:github", TOK),
  refreshTokenEnc: null,
  expiresAt: null,
  scopes: null,
  status: "ACTIVE",
  ...over,
});

beforeEach(() => {
  routes.length = 0;
  vi.clearAllMocks();
  process.env.RABBIT_INTEGRATION_SECRET = SECRET;
  process.env.SCM_GITHUB_BASE_URL = MOCK_GH;
  process.env.SCM_GITLAB_BASE_URL = MOCK_GL;
  vi.mocked(prisma.scmOrgApp.findUnique).mockImplementation(
    (async (args: unknown) => {
      const where = (args as { where: { orgId_provider: { provider: string } } }).where;
      return orgApp(where.orgId_provider.provider);
    }) as never,
  );
});
afterEach(() => {
  delete process.env.SCM_GITHUB_BASE_URL;
  delete process.env.SCM_GITLAB_BASE_URL;
  delete process.env.RABBIT_INTEGRATION_SECRET;
});

describe("state（防 CSRF，一次性消费）", () => {
  it("签发→消费回载荷；二次消费 → 40472", async () => {
    const state = await issueScmState({
      orgId: "org-1",
      userId: "u1",
      provider: "github",
      origin: "http://w",
    });
    const p = await consumeScmState(state);
    expect(p).toMatchObject({ orgId: "org-1", userId: "u1", provider: "github" });
    await expect(consumeScmState(state)).rejects.toMatchObject({
      code: ErrCode.SCM_OAUTH_STATE_INVALID,
    });
    await expect(consumeScmState(null)).rejects.toBeInstanceOf(DomainError);
  });
});

describe("buildScmAuthorizeUrl", () => {
  it("未配置 App → 40471；配置后 URL 含 client_id/redirect_uri/state/scope", async () => {
    vi.mocked(prisma.scmOrgApp.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.systemParam.findUnique).mockResolvedValue({ value: {} } as never);
    await expect(buildScmAuthorizeUrl("org-1", "u1", "github", "http://w")).rejects.toMatchObject({
      code: ErrCode.SCM_APP_NOT_CONFIGURED,
    });

    vi.mocked(prisma.scmOrgApp.findUnique).mockResolvedValue(orgApp("github") as never);
    const url = await buildScmAuthorizeUrl("org-1", "u1", "github", "http://w");
    const u = new URL(url);
    expect(url.startsWith(MOCK_GH)).toBe(true); // env 覆盖生效
    expect(u.searchParams.get("client_id")).toBe("client-github");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "http://w/api/v1/orgs/org-1/scm/oauth/github/callback",
    );
    expect(u.searchParams.get("scope")).toBe("read:user repo");
    expect(u.searchParams.get("state")).toBeTruthy();
  });
});

describe("handleScmCallback", () => {
  it("happy path：换 token → 拉身份 → upsert 账号（token 加密）", async () => {
    const state = await issueScmState({
      orgId: "org-1",
      userId: "u1",
      provider: "github",
      origin: "http://w",
    });
    addRoute(
      (u) => u === `${MOCK_GH}/login/oauth/access_token`,
      () => new Response(JSON.stringify({ access_token: TOK }), { status: 200 }),
    );
    addRoute(
      (u) => u === `${MOCK_GH}/user`,
      () =>
        new Response(JSON.stringify({ login: "xujialiang", name: "许", avatar_url: "http://a" }), {
          status: 200,
        }),
    );
    vi.mocked(prisma.scmAccount.upsert).mockResolvedValue({} as never);
    const r = await handleScmCallback("org-1", "github", "code-1", state);
    expect(r.login).toBe("xujialiang");
    const arg = vi.mocked(prisma.scmAccount.upsert).mock.calls[0]![0];
    expect(arg.create).toMatchObject({
      orgId: "org-1",
      userId: "u1",
      login: "xujialiang",
      status: "ACTIVE",
    });
    expect((arg.create as unknown as Record<string, string>).tokenEnc).not.toBe(TOK); // 密文非明文
  });

  it("state 与 org/provider 不匹配 → 40472", async () => {
    const state = await issueScmState({
      orgId: "org-2",
      userId: "u1",
      provider: "github",
      origin: "http://w",
    });
    await expect(handleScmCallback("org-1", "github", "code-1", state)).rejects.toMatchObject({
      code: ErrCode.SCM_OAUTH_STATE_INVALID,
    });
  });

  it("token 端点非 2xx → 40479", async () => {
    const state = await issueScmState({
      orgId: "org-1",
      userId: "u1",
      provider: "github",
      origin: "http://w",
    });
    addRoute(
      (u) => u === `${MOCK_GH}/login/oauth/access_token`,
      () => new Response("bad", { status: 400 }),
    );
    await expect(handleScmCallback("org-1", "github", "code-1", state)).rejects.toMatchObject({
      code: ErrCode.SCM_PROVIDER_ERROR,
    });
  });
});

describe("listAccountRepos（github 归一 + keyword 过滤 + 信封）", () => {
  it("full_name/clone_url/ssh_url 归一；keyword 本地过滤", async () => {
    vi.mocked(prisma.scmAccount.findFirst).mockResolvedValue(accountRow() as never);
    addRoute(
      (u) => u.startsWith(`${MOCK_GH}/user/repos`),
      () =>
        new Response(
          JSON.stringify([
            {
              full_name: "RabbitAI-Lab/rabbit-web",
              default_branch: "main",
              private: true,
              clone_url: "https://github.com/RabbitAI-Lab/rabbit-web.git",
              ssh_url: "git@github.com:RabbitAI-Lab/rabbit-web.git",
            },
            {
              full_name: "xujialiang/tutorials",
              default_branch: "master",
              private: false,
              clone_url: "",
              ssh_url: "",
            },
          ]),
          { status: 200 },
        ),
    );
    const r = await listAccountRepos("org-1", "acc-1", {
      keyword: "rabbit",
      page: 1,
      pageSize: 20,
    });
    expect(r.total).toBe(1);
    expect(r.items[0]).toMatchObject({
      owner: "RabbitAI-Lab",
      repo: "rabbit-web",
      visibility: "private",
      sshUrl: "git@github.com:RabbitAI-Lab/rabbit-web.git",
    });
  });

  it("账号已撤销 → 40478", async () => {
    vi.mocked(prisma.scmAccount.findFirst).mockResolvedValue(
      accountRow({ status: "REVOKED" }) as never,
    );
    await expect(
      listAccountRepos("org-1", "acc-1", { page: 1, pageSize: 20 }),
    ).rejects.toMatchObject({ code: ErrCode.SCM_ACCOUNT_NOT_FOUND });
  });
});

describe("GitLab token 旋转（2h 过期）", () => {
  it("临期账号 → refresh_token 换新并落库", async () => {
    vi.mocked(prisma.scmAccount.findFirst).mockResolvedValue(
      accountRow({
        provider: "gitlab",
        tokenEnc: encryptCredential("scm-account:gitlab", `${SECRET}:old`),
        refreshTokenEnc: encryptCredential("scm-account:gitlab", REFRESH),
        expiresAt: new Date(Date.now() - 1000),
      }) as never,
    );
    addRoute(
      (u) => u === `${MOCK_GL}/oauth/token`,
      () =>
        new Response(
          JSON.stringify({
            access_token: TOK,
            refresh_token: REFRESH,
            expires_in: 7200,
            created_at: Math.floor(Date.now() / 1000),
          }),
          { status: 200 },
        ),
    );
    vi.mocked(prisma.scmAccount.update).mockResolvedValue({} as never);
    const token = await accountToken("org-1", "acc-1");
    expect(token).toBe(TOK);
    const body = (vi.mocked(globalThis.fetch).mock.calls.at(-1)?.[1] as RequestInit).body;
    expect(String(body)).toContain("grant_type=refresh_token");
    expect(prisma.scmAccount.update).toHaveBeenCalled();
  });

  it("过期且无 refresh_token → 40478 引导重新授权", async () => {
    vi.mocked(prisma.scmAccount.findFirst).mockResolvedValue(
      accountRow({
        provider: "gitlab",
        expiresAt: new Date(Date.now() - 1000),
        refreshTokenEnc: null,
      }) as never,
    );
    await expect(accountToken("org-1", "acc-1")).rejects.toMatchObject({
      code: ErrCode.SCM_ACCOUNT_NOT_FOUND,
    });
  });
});
