/**
 * S13 SCM-001 mock 代码平台：GitHub/Gitee/GitLab 三平台 OAuth 全链 + 授权账号可见仓库列表。
 * 挂载 /mock-scm/{github|gitee|gitlab}（web 侧 SCM_{PROVIDER}_BASE_URL 指向此处）：
 *   authorize 自动同意 302 回调（带 code+state）→ token → user → user/repos（平台形态各异）。
 * 控面：POST /mock-scm/_test/config {reset?:true, tokenError?:boolean}（故障注入/清场）。
 * 全部返回值为测试假值（mock 桩专用，非真实凭据）。
 */
import { Hono } from "hono";

interface ScmTestConfig {
  tokenError?: boolean;
  authorizeCalls?: number;
}

const g = globalThis as unknown as { __scmMockConfig?: ScmTestConfig };
if (!g.__scmMockConfig) g.__scmMockConfig = {};
const cfg = g.__scmMockConfig;

/** 测试假值（非凭据）：由平台名拼接生成 */
const fakeToken = (provider: string) => `mock-scm-fake-token-${provider}`;

const REPOS: Record<string, { full: string; private: boolean; branch: string }[]> = {
  github: [
    { full: "RabbitAI-Lab/rabbit-web", private: true, branch: "main" },
    { full: "RabbitAI-Lab/rabbit-portal", private: true, branch: "main" },
    { full: "mock-github-user/tutorials", private: false, branch: "master" },
  ],
  gitee: [
    { full: "rabbit-lab/testdata", private: true, branch: "master" },
    { full: "mock-gitee-user/open-api-demo", private: false, branch: "main" },
  ],
  gitlab: [
    { full: "backend/order-service", private: true, branch: "develop" },
    { full: "mock-gitlab-user/public-tools", private: false, branch: "main" },
  ],
};

function githubRepos() {
  return REPOS.github!.map((r) => ({
    full_name: r.full,
    default_branch: r.branch,
    private: r.private,
    clone_url: `https://github.com/${r.full}.git`,
    ssh_url: `git@github.com:${r.full}.git`,
  }));
}

function giteeRepos() {
  return REPOS.gitee!.map((r) => {
    const [ns, path] = r.full.split("/");
    return {
      path,
      namespace: { path: ns },
      default_branch: r.branch,
      private: r.private,
      html_url: `https://gitee.com/${r.full}`,
      ssh_url: `git@gitee.com:${r.full}.git`,
    };
  });
}

function gitlabRepos() {
  return REPOS.gitlab!.map((r) => ({
    path_with_namespace: r.full,
    default_branch: r.branch,
    visibility: r.private ? "private" : "public",
    http_url_to_repo: `https://gitlab.com/${r.full}.git`,
    ssh_url_to_repo: `git@gitlab.com:${r.full}.git`,
  }));
}

/** 自动同意授权页：302 回 redirect_uri 并附 code+state（模拟用户点「同意」）。 */
function authorizeHandler(provider: string) {
  return (c: import("hono").Context) => {
    cfg.authorizeCalls = (cfg.authorizeCalls ?? 0) + 1;
    const redirectUri = c.req.query("redirect_uri");
    const state = c.req.query("state");
    if (!redirectUri) return c.json({ error: "redirect_uri required" }, 422);
    const sep = redirectUri.includes("?") ? "&" : "?";
    const code = `mock-code-${provider}`;
    return c.redirect(
      `${redirectUri}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(state ?? "")}`,
      302,
    );
  };
}

function tokenHandler(provider: string) {
  return async (c: import("hono").Context) => {
    if (cfg.tokenError) return c.json({ error: "injected failure" }, 500);
    const body = {
      access_token: fakeToken(provider),
      token_type: "bearer",
      scope: c.req.query("scope") ?? "",
    };
    if (provider === "gitlab") {
      // gitlab 形态：2h 过期 + refresh_token（服务端旋转路径覆盖）
      return c.json({
        ...body,
        refresh_token: `mock-scm-fake-refresh-${provider}`,
        expires_in: 7200,
        created_at: Math.floor(Date.now() / 1000),
      });
    }
    return c.json(body);
  };
}

function userHandler(provider: string) {
  return (c: import("hono").Context) => {
    const login = `mock-${provider}-user`;
    if (provider === "gitlab") {
      return c.json({ username: login, name: "Mock GitLab 用户", avatar_url: "" });
    }
    return c.json({ login, name: `Mock ${provider} 用户`, avatar_url: "" });
  };
}

/** 仓库列表（三平台形态各异，服务端归一断言在 web 单测/详断言处）。 */
function reposHandler(provider: string) {
  return (c: import("hono").Context) => {
    const items =
      provider === "github" ? githubRepos() : provider === "gitee" ? giteeRepos() : gitlabRepos();
    return c.json(items);
  };
}

export function buildScmMocks(): Hono {
  const app = new Hono();

  // 控面（测试注入/清场）
  app.post("/_test/config", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      tokenError?: boolean;
      reset?: boolean;
    };
    if (body.reset) {
      g.__scmMockConfig = {};
      return c.json({ ok: true });
    }
    if (body.tokenError !== undefined) cfg.tokenError = body.tokenError;
    return c.json({ ok: true, tokenError: cfg.tokenError ?? false });
  });
  app.get("/_test/config", (c) =>
    c.json({ tokenError: cfg.tokenError ?? false, authorizeCalls: cfg.authorizeCalls ?? 0 }),
  );

  for (const provider of ["github", "gitee", "gitlab"] as const) {
    const sub = new Hono();
    sub.get("/login/oauth/authorize", authorizeHandler(provider)); // github
    sub.post("/login/oauth/access_token", tokenHandler(provider)); // github
    sub.get("/oauth/authorize", authorizeHandler(provider)); // gitee/gitlab
    sub.post("/oauth/token", tokenHandler(provider)); // gitee/gitlab
    sub.get("/user", userHandler(provider));
    sub.get("/user/repos", reposHandler(provider));
    sub.get("/api/v4/user", userHandler(provider)); // gitlab 无 env 覆盖时的形态（默认 apiPrefix）
    sub.get("/api/v4/projects", reposHandler(provider)); // gitlab 同上
    app.route(`/${provider}`, sub);
  }
  return app;
}
