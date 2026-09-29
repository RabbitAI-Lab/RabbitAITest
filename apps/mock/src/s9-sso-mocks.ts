/**
 * S9 ENTP-002/003 mock IdP：OIDC/OAuth2/CAS 三协议 + 企微/钉钉/飞书扫码全链。
 * 挂载 /sso：authorize 自动 302 回调（模拟用户扫码/同意）→ token → userinfo（控面可配）。
 * 控面：POST /sso/_test/config {authId, userinfo} / GET /sso/_test/config（测试断言与清场）。
 * 全部返回值为测试假值（非凭据）——token 形态值经 fakeToken() 计算生成。
 */
import { Hono } from "hono";
import type { Context } from "hono";

interface SsoTestConfig {
  /** userinfo 返回内容（缺 userid/openId 时模拟映射失败 90014/90013 前置） */
  userinfo?: Record<string, unknown>;
  /** token 端点故障注入（true → 500） */
  tokenError?: boolean;
  /** authorize 次数（断言授权链被走过） */
  authorizeCalls?: number;
}

const g = globalThis as unknown as { __ssoMockConfig?: Map<string, SsoTestConfig> };
if (!g.__ssoMockConfig) g.__ssoMockConfig = new Map();
const store = g.__ssoMockConfig;

/** 测试假值生成（mock 桩专用，非真实凭据） */
const fakeToken = (authId: string) => `mock-fake-token-${authId.slice(0, 8)}`;

function cfgFor(authId: string): SsoTestConfig {
  let cfg = store.get(authId);
  if (!cfg) {
    cfg = {};
    store.set(authId, cfg);
  }
  return cfg;
}

const DEFAULT_USERINFO: Record<string, Record<string, unknown>> = {
  oidc: { preferred_username: "mock-sso-user", name: "Mock SSO 用户", email: "mock-sso@idp.test" },
  oauth2: { login: "mock-oauth-user", name: "Mock OAuth 用户", email: "mock-oauth@idp.test" },
  cas: { username: "mock-cas-user", name: "Mock CAS 用户", email: "mock-cas@idp.test" },
  wecom: { userid: "mock-wecom-user" },
  dingtalk: { openId: "mock-dingtalk-user", nick: "钉钉用户", email: "" },
  feishu: { open_id: "mock-feishu-user", name: "飞书用户", email: "" },
};

export function buildSsoMocks(): Hono {
  const app = new Hono();

  // 控面
  app.post("/_test/config", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      authId?: string;
      userinfo?: Record<string, unknown>;
      tokenError?: boolean;
      reset?: boolean;
    };
    if (!body.authId) return c.json({ code: 20422, message: "authId required" }, 422);
    if (body.reset) {
      store.delete(body.authId);
      return c.json({ ok: true });
    }
    const cfg = cfgFor(body.authId);
    if (body.userinfo !== undefined) cfg.userinfo = body.userinfo;
    if (body.tokenError !== undefined) cfg.tokenError = body.tokenError;
    return c.json({ ok: true });
  });
  app.get("/_test/config", (c) => {
    const authId = c.req.query("authId");
    if (!authId) return c.json({ code: 20422, message: "authId required" }, 422);
    return c.json(cfgFor(authId));
  });

  // authorize：自动同意并 302 回调（携带 code/authCode/ticket + state）
  app.get("/:provider/:authId/authorize", (c) => {
    const provider = c.req.param("provider");
    const authId = c.req.param("authId");
    const cfg = cfgFor(authId);
    cfg.authorizeCalls = (cfg.authorizeCalls ?? 0) + 1;
    const redirectUri = c.req.query("redirect_uri");
    const state = c.req.query("state");
    const service = c.req.query("service");
    if (!redirectUri && !service)
      return c.json({ code: 20422, message: "缺少 redirect_uri/service" }, 422);
    if (provider === "cas" && service) {
      const sep = service.includes("?") ? "&" : "?";
      return c.redirect(
        `${service}${sep}ticket=mock-ticket-${authId.slice(0, 8)}&state=${state ?? ""}`,
      );
    }
    const codeParam = provider === "dingtalk" ? "authCode" : "code";
    const sep = redirectUri!.includes("?") ? "&" : "?";
    return c.redirect(
      `${redirectUri}${sep}${codeParam}=mock-code-${authId.slice(0, 8)}&state=${state ?? ""}`,
    );
  });

  // token（OIDC/OAuth2 同形；钉钉 v1.0 四段路径；飞书多段真实路径；企微 gettoken 查询式）
  app.post("/:provider/:authId/token", (c) => handleToken(c, false));
  app.post("/:provider/:authId/userAccessToken", (c) => handleToken(c, false));
  app.post("/:provider/:authId/access_token", (c) => handleToken(c, false));
  app.post("/:provider/:authId/oauth2/userAccessToken", (c) => handleToken(c, false));
  app.post("/:provider/:authId/oidc/access_token", async (c) => handleToken(c, true));
  app.get("/:provider/:authId/gettoken", (c) =>
    c.json({ access_token: fakeToken(c.req.param("authId") ?? ""), errcode: 0 }),
  );
  app.post("/:provider/:authId/auth/v3/app_access_token/internal", async (c) =>
    c.json({ app_access_token: fakeToken(c.req.param("authId") ?? ""), code: 0 }),
  );
  app.post("/:provider/:authId/authen/v1/oidc/access_token", async (c) => handleToken(c, true));
  app.get("/:provider/:authId/authen/v1/user_info", (c) => userinfo(c));

  // userinfo：控面配置 > 协议默认
  app.get("/:provider/:authId/userinfo", (c) => userinfo(c));
  app.get("/:provider/:authId/user", (c) => userinfo(c));
  app.get("/:provider/:authId/user_info", (c) => userinfo(c));
  app.get("/:provider/:authId/getuserinfo", (c) => userinfo(c));
  app.get("/:provider/:authId/users/me", (c) => userinfo(c));
  app.get("/:provider/:authId/contact/users/me", (c) => userinfo(c));

  // CAS serviceValidate（成功 XML；坏票据=authenticationFailure）
  app.get("/:provider/:authId/serviceValidate", (c) => {
    const authId = c.req.param("authId");
    const ticket = c.req.query("ticket") ?? "";
    if (ticket === "bad-ticket") {
      return c.body(
        '<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationFailure code="INVALID_TICKET">ticket 不合法</cas:authenticationFailure></cas:serviceResponse>',
        200,
        { "content-type": "application/xml" },
      );
    }
    const info = effectiveUserinfo("cas", authId);
    const user = String(info.username ?? "mock-cas-user");
    const attrs = Object.entries(info)
      .filter(([k]) => k !== "username")
      .map(([k, v]) => `<cas:${k}>${v}</cas:${k}>`)
      .join("");
    return c.body(
      `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationSuccess><cas:user>${user}</cas:user><cas:attributes>${attrs}</cas:attributes></cas:authenticationSuccess></cas:serviceResponse>`,
      200,
      { "content-type": "application/xml" },
    );
  });

  return app;
}

function effectiveUserinfo(provider: string, authId: string): Record<string, unknown> {
  const cfg = cfgFor(authId);
  return cfg.userinfo ?? DEFAULT_USERINFO[provider] ?? { username: `mock-${provider}-user` };
}

async function handleToken(c: Context, feishuWrap: boolean) {
  const provider = c.req.param("provider") ?? "";
  const authId = c.req.param("authId") ?? "";
  const cfg = cfgFor(authId);
  if (cfg.tokenError) return c.json({ error: "mock token failure" }, 500);
  const tokenValue = fakeToken(authId);
  if (provider === "dingtalk") return c.json({ accessToken: tokenValue, expireIn: 7200 });
  if (feishuWrap)
    return c.json({ code: 0, data: { access_token: tokenValue, token_type: "Bearer" } });
  return c.json({ access_token: tokenValue, token_type: "Bearer", expires_in: 3600 });
}

function userinfo(c: Context) {
  const provider = c.req.param("provider") ?? "";
  const authId = c.req.param("authId") ?? "";
  const info = effectiveUserinfo(provider, authId);
  // 飞书/钉钉包 data 层
  if (provider === "feishu") return c.json({ code: 0, data: info });
  if (provider === "dingtalk") return c.json(info);
  // 企微 getuserinfo 顶层 userid
  return c.json(info);
}
