/**
 * ENTP-002/003 SSO 登录流：state（Redis 5 分钟）→ authorize 302 → callback 换身份 → find-or-create → 会话。
 * OIDC/OAuth2/CAS + 扫码三平台（WECOM/DINGTALK/FEISHU）共用本流。
 */
import { randomUUID } from "node:crypto";
import { DomainError, ErrCode, type PropMapping } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { redis } from "@/server/redis";
import { hashPassword } from "@/server/domains/system/auth.service";
import { outboundDispatcher } from "@/server/safe-fetch";

/** 模块级出站 dispatcher（连接期 IP 校验；测试栈指向 mock IdP 环回时放行——OUTBOUND_ALLOW_PRIVATE 同口径）。
 *  v0.7.1 Mimosa 根治形态：调用方持实例直连 fetch，不做 safeFetch 薄包装。 */
const SSO_DISPATCHER = outboundDispatcher({
  allowPrivate: process.env.OUTBOUND_ALLOW_PRIVATE === "1",
});
import { loadSource, type LoadedSource } from "./sso.service";
import { buildScanAuthorizeUrl, SCAN_PROVIDER_META, type ScanProvider } from "@rabbit/shared";

/** config Json 值安全取串（noUncheckedIndexedAccess 防御）。 */
const S = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

const STATE_TTL_SEC = 300;
const stateKey = (state: string) => `sso:state:${state}`;

export async function issueState(authId: string): Promise<string> {
  const state = randomUUID().replace(/-/g, "");
  await redis().set(stateKey(state), authId, "EX", STATE_TTL_SEC);
  return state;
}

export async function consumeState(state: string | null): Promise<string> {
  if (!state) throw new DomainError(ErrCode.SSO_STATE_INVALID, "缺少 state 参数");
  const authId = await redis().get(stateKey(state));
  if (!authId)
    throw new DomainError(ErrCode.SSO_STATE_INVALID, "授权状态无效或已过期，请重新发起登录");
  await redis().del(stateKey(state));
  return authId;
}

export async function requireEnabledSource(authId: string): Promise<LoadedSource> {
  const src = await loadSource(authId);
  if (!src.enabled) throw new DomainError(ErrCode.SSO_SOURCE_DISABLED, "认证源已停用");
  return src;
}

/**
 * 本站回调绝对地址：取发起请求的 origin（部署免配置即正确；siteUrl 仅作展示）
 * ——e2e/jmeter 栈端口与 base.siteUrl 默认值不一致时仍能回跳（S9 勘误 1）。
 */
function callbackUrl(origin: string, type: string, authId: string): string {
  return `${origin.replace(/\/$/, "")}/api/v1/auth/sso/${authId}/${type}/callback`;
}

/** authorize 302 目标构造。 */
export async function buildAuthorizeUrl(authId: string, origin: string): Promise<{ url: string }> {
  const src = await requireEnabledSource(authId);
  const state = await issueState(authId);
  const cfg = src.config;
  switch (src.type) {
    case "OIDC":
    case "OAUTH2": {
      const redirectUri = callbackUrl(origin, src.type.toLowerCase(), authId);
      const q = new URLSearchParams({
        response_type: "code",
        client_id: S(cfg.clientId),
        redirect_uri: redirectUri,
        scope: S(cfg.scope) || "openid profile email",
        state,
      });
      return { url: `${S(cfg.authEndpoint)}?${q}` };
    }
    case "CAS": {
      const service = callbackUrl(origin, "cas", authId);
      return {
        url: `${S(cfg.serverUrl).replace(/\/$/, "")}/login?service=${encodeURIComponent(service)}`,
      };
    }
    case "WECOM":
    case "DINGTALK":
    case "FEISHU": {
      const provider = SCAN_PROVIDER_META[src.type as ScanProvider];
      const redirectUri = callbackUrl(origin, provider.callbackType, authId);
      return {
        url: buildScanAuthorizeUrl(src.type as ScanProvider, {
          authId,
          state,
          redirectUri,
          config: src.config,
        }),
      };
    }
    default:
      throw new DomainError(
        ErrCode.SSO_CONFIG_INVALID,
        `该认证源类型（${src.type}）不支持跳转登录`,
      );
  }
}

/** IdP userinfo 形状（OIDC/OAuth2/CAS/扫码归一）。 */
export interface SsoIdentity {
  providerUserId: string;
  name?: string;
  email?: string;
}

export async function exchangeOidc(
  src: LoadedSource,
  code: string,
  origin: string,
): Promise<SsoIdentity> {
  const cfg = src.config;
  const redirectUri = callbackUrl(origin, src.type.toLowerCase(), src.id);
  const tokenRes = await fetch(S(cfg.tokenEndpoint), {
    ...{
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: S(cfg.clientId),
        client_secret: S(cfg.clientSecret),
        redirect_uri: redirectUri,
      }),
    },
    dispatcher: SSO_DISPATCHER,
  } as RequestInit & { dispatcher: unknown });
  if (!tokenRes.ok)
    throw new DomainError(ErrCode.SSO_PROVIDER_ERROR, `IdP Token 端点响应 ${tokenRes.status}`);
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token)
    throw new DomainError(ErrCode.SSO_PROVIDER_ERROR, "IdP 未返回 access_token");
  const userRes = await fetch(S(cfg.userinfoEndpoint), {
    ...{
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
    },
    dispatcher: SSO_DISPATCHER,
  } as RequestInit & { dispatcher: unknown });
  if (!userRes.ok)
    throw new DomainError(ErrCode.SSO_PROVIDER_ERROR, `IdP 用户信息端点响应 ${userRes.status}`);
  return mapIdentity(src.config, await userRes.json());
}

export async function exchangeCas(
  src: LoadedSource,
  ticket: string,
  service: string,
): Promise<SsoIdentity> {
  const cfg = src.config;
  const validateUrl = `${S(cfg.serverUrl).replace(/\/$/, "")}/serviceValidate?service=${encodeURIComponent(service)}&ticket=${encodeURIComponent(ticket)}`;
  const res = await fetch(validateUrl, {
    ...{ headers: { Accept: "application/xml" } },
    dispatcher: SSO_DISPATCHER,
  } as RequestInit & { dispatcher: unknown });
  if (!res.ok)
    throw new DomainError(ErrCode.SSO_PROVIDER_ERROR, `CAS serviceValidate 响应 ${res.status}`);
  const xml = await res.text();
  if (xml.includes("authenticationFailure"))
    throw new DomainError(ErrCode.SSO_PROVIDER_ERROR, "CAS 票据校验失败");
  const { XMLParser } = await import("fast-xml-parser");
  const doc = new XMLParser({ ignoreAttributes: false }).parse(xml) as Record<string, unknown>;
  const success = (doc["cas:serviceResponse"] as Record<string, unknown>)?.[
    "cas:authenticationSuccess"
  ] as Record<string, unknown> | undefined;
  if (!success)
    throw new DomainError(ErrCode.SSO_PROVIDER_ERROR, "CAS 响应缺少 authenticationSuccess");
  // 属性元素键带 cas: 前缀（<cas:attributes><cas:email>…）——归一化去前缀后进映射
  const rawAttrs = (success["cas:attributes"] as Record<string, unknown>) ?? {};
  const attrs = Object.fromEntries(
    Object.entries(rawAttrs).map(([k, v]) => [k.replace(/^cas:/, ""), v]),
  );
  return mapIdentity(src.config, {
    ...attrs,
    username: success["cas:user"],
  });
}

// ── 扫码三平台（ENTP-003）──

export async function exchangeWecom(src: LoadedSource, code: string): Promise<SsoIdentity> {
  const cfg = src.config;
  // apiBase：测试栈注入 mock 平台（缺省真实企微）
  const base = cfg.apiBase ? String(cfg.apiBase).replace(/\/$/, "") : "https://qyapi.weixin.qq.com";
  const tokenRes = await fetch(
    `${base}/gettoken?corpid=${encodeURIComponent(S(cfg.corpId))}&corpsecret=${encodeURIComponent(S(cfg.secret))}`,
    { ...{}, dispatcher: SSO_DISPATCHER } as RequestInit & { dispatcher: unknown },
  );
  const token = (await tokenRes.json()) as { access_token?: string; errcode?: number };
  if (!token.access_token)
    throw new DomainError(
      ErrCode.SSO_PROVIDER_ERROR,
      `企微 gettoken 失败（errcode ${token.errcode}）`,
    );
  const userRes = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${token.access_token}&code=${encodeURIComponent(code)}`,
    { ...{}, dispatcher: SSO_DISPATCHER } as RequestInit & { dispatcher: unknown },
  );
  const user = (await userRes.json()) as { userid?: string };
  if (!user.userid) throw new DomainError(ErrCode.SSO_PROVIDER_ERROR, "企微未返回 userid");
  return { providerUserId: user.userid };
}

export async function exchangeDingtalk(src: LoadedSource, authCode: string): Promise<SsoIdentity> {
  const cfg = src.config;
  const base = cfg.apiBase
    ? String(cfg.apiBase).replace(/\/$/, "")
    : "https://api.dingtalk.com/v1.0";
  const tokenRes = await fetch(`${base}/oauth2/userAccessToken`, {
    ...{
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: S(cfg.clientId),
        clientSecret: S(cfg.clientSecret),
        code: authCode,
        grantType: "authorization_code",
      }),
    },
    dispatcher: SSO_DISPATCHER,
  } as RequestInit & { dispatcher: unknown });
  const token = (await tokenRes.json()) as { accessToken?: string };
  if (!token.accessToken)
    throw new DomainError(ErrCode.SSO_PROVIDER_ERROR, "钉钉 userAccessToken 获取失败");
  const userRes = await fetch(`${base}/contact/users/me`, {
    ...{
      headers: { "x-acs-dingtalk-access-token": token.accessToken },
    },
    dispatcher: SSO_DISPATCHER,
  } as RequestInit & { dispatcher: unknown });
  const user = (await userRes.json()) as { openId?: string; nick?: string; email?: string };
  if (!user.openId) throw new DomainError(ErrCode.SSO_PROVIDER_ERROR, "钉钉未返回 openId");
  return { providerUserId: user.openId, name: user.nick, email: user.email };
}

export async function exchangeFeishu(src: LoadedSource, code: string): Promise<SsoIdentity> {
  const cfg = src.config;
  const base = cfg.apiBase
    ? String(cfg.apiBase).replace(/\/$/, "")
    : "https://open.feishu.cn/open-apis";
  const tokenRes = await fetch(`${base}/auth/v3/app_access_token/internal`, {
    ...{
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: S(cfg.appId), app_secret: S(cfg.appSecret) }),
    },
    dispatcher: SSO_DISPATCHER,
  } as RequestInit & { dispatcher: unknown });
  const appToken = (await tokenRes.json()) as { app_access_token?: string; code?: number };
  if (!appToken.app_access_token)
    throw new DomainError(
      ErrCode.SSO_PROVIDER_ERROR,
      `飞书 app_access_token 获取失败（code ${appToken.code}）`,
    );
  const userAccessTokenRes = await fetch(`${base}/authen/v1/oidc/access_token`, {
    ...{
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${appToken.app_access_token}`,
      },
      body: JSON.stringify({ grant_type: "authorization_code", code }),
    },
    dispatcher: SSO_DISPATCHER,
  } as RequestInit & { dispatcher: unknown });
  const uat = ((await userAccessTokenRes.json()) as { data?: { access_token?: string } }).data;
  if (!uat?.access_token)
    throw new DomainError(ErrCode.SSO_PROVIDER_ERROR, "飞书 user access_token 获取失败");
  const userRes = await fetch(`${base}/authen/v1/user_info`, {
    ...{
      headers: { Authorization: `Bearer ${uat.access_token}` },
    },
    dispatcher: SSO_DISPATCHER,
  } as RequestInit & { dispatcher: unknown });
  const user = (
    (await userRes.json()) as { data?: { open_id?: string; name?: string; email?: string } }
  ).data;
  if (!user?.open_id) throw new DomainError(ErrCode.SSO_PROVIDER_ERROR, "飞书未返回 open_id");
  return { providerUserId: user.open_id, name: user.name, email: user.email };
}

/** 属性映射（username/name/email 三键；username/email 必需）。 */
function mapIdentity(
  config: Record<string, unknown>,
  userinfo: Record<string, unknown>,
): SsoIdentity {
  const mapping = (config.propMapping ?? {}) as Partial<Record<keyof PropMapping, string>>;
  const pick = (key: "username" | "name" | "email") => {
    const v = userinfo[mapping[key] ?? key];
    return typeof v === "string" && v ? v : undefined;
  };
  const providerUserId = pick("username") ?? pick("email");
  if (!providerUserId)
    throw new DomainError(
      ErrCode.SSO_USER_MAPPING_FAILED,
      "身份属性映射失败（userinfo 缺少 username/email 映射值）",
    );
  return { providerUserId, name: pick("name"), email: pick("email") };
}

/**
 * find-or-create（ENTP-002 §2）：
 *  - email 存在且 source=LOCAL → 绑定（source 更新为 SSO 类型）
 *  - email 存在且 source=其他 SSO 类型 → 409 90016
 *  - 不存在 → 创建（passwordHash=随机不可登录值；不自动入组织——管理员后续加入）
 *  - 扫码无 email → 合成 `{providerUserId}@sso.scan` 幂等账号
 */
export async function findOrCreateSsoUser(
  identity: SsoIdentity,
  sourceType: string,
): Promise<{ userId: string; email: string }> {
  const email = identity.email?.trim()
    ? identity.email.trim()
    : `${identity.providerUserId}@sso.scan`;
  const exist = await prisma.user.findFirst({
    where: { email },
    select: { id: true, email: true, source: true },
  });
  if (exist) {
    if (exist.source === "LOCAL" || exist.source === sourceType) {
      if (exist.source !== sourceType) {
        await prisma.user.update({ where: { id: exist.id }, data: { source: sourceType } });
      }
      return { userId: exist.id, email: exist.email };
    }
    throw new DomainError(
      ErrCode.SSO_ACCOUNT_CONFLICT,
      "该账号已绑定其他登录方式，请使用原方式登录",
    );
  }
  const user = await prisma.user.create({
    data: {
      email,
      name: identity.name?.trim() || identity.providerUserId,
      passwordHash: await hashPassword(`sso-${randomUUID()}`), // 随机值：本地口令不可登录
      source: sourceType,
    },
    select: { id: true, email: true },
  });
  return { userId: user.id, email: user.email };
}
