/**
 * SCM-001 OAuth 授权流：state（Redis 5min 一次性）→ authorize 302 → callback 换 token → 账号 upsert；
 * 授权账号组织内共享；GitLab access_token 2h 过期按 refresh_token 旋转。
 * 出站：assertSafeOutboundUrl（解析期）+ SCM_DISPATCHER（连接期，§8.6 形态——fetch 表达式零 env 读取）。
 */
import { randomUUID } from "node:crypto";
import { DomainError, ErrCode, SCM_PROVIDER_META, type ScmOauthProvider } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { redis } from "@/server/redis";
import { outboundDispatcher } from "@/server/safe-fetch";
import { assertSafeOutboundUrl } from "@/server/domains/api/outbound-guard";
import { decryptCredential, encryptCredential } from "@/server/domains/api/credential-crypto";
import { effectiveScmBases } from "./scm-app.service";

const SCM_DISPATCHER = outboundDispatcher({
  allowPrivate: process.env.OUTBOUND_ALLOW_PRIVATE === "1",
});

const STATE_TTL_SEC = 300;
const stateKey = (state: string) => `scm:oauth:state:${state}`;
const OUTBOUND_TIMEOUT_MS = 15_000;

/** 出站 fetch（FetchLike 形态，git-adapters/自用共用）：解析期 SSRF 守卫 + 连接期 dispatcher + 双超时。 */
export async function scmOutboundFetch(url: string, init?: RequestInit): Promise<Response> {
  await assertSafeOutboundUrl(url);
  return fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
    dispatcher: SCM_DISPATCHER,
  } as RequestInit & { dispatcher: unknown });
}

// ── state（防 CSRF：一次性消费） ──

export interface ScmOAuthStatePayload {
  orgId: string;
  userId: string;
  provider: ScmOauthProvider;
  origin: string;
}

export async function issueScmState(payload: ScmOAuthStatePayload): Promise<string> {
  const state = randomUUID().replace(/-/g, "");
  await redis().set(stateKey(state), JSON.stringify(payload), "EX", STATE_TTL_SEC);
  return state;
}

export async function consumeScmState(state: string | null): Promise<ScmOAuthStatePayload> {
  if (!state) throw new DomainError(ErrCode.SCM_OAUTH_STATE_INVALID, "缺少 state 参数");
  const raw = await redis().get(stateKey(state));
  if (!raw) throw new DomainError(ErrCode.SCM_OAUTH_STATE_INVALID, ErrMsgStateInvalid());
  await redis().del(stateKey(state));
  return JSON.parse(raw) as ScmOAuthStatePayload;
}

function ErrMsgStateInvalid(): string {
  return "授权状态无效或已过期，请重新发起授权";
}

// ── 授权流 ──

export function scmCallbackUrl(origin: string, orgId: string, provider: ScmOauthProvider): string {
  return `${origin.replace(/\/$/, "")}/api/v1/orgs/${orgId}/scm/oauth/${provider}/callback`;
}

/** 发起授权：解析生效 App（未配置 → 40471）→ state → 平台 authorize URL。 */
export async function buildScmAuthorizeUrl(
  orgId: string,
  userId: string,
  provider: ScmOauthProvider,
  origin: string,
): Promise<string> {
  const { app, bases } = await effectiveScmBases(orgId, provider);
  if (app.source === "none" || !app.clientId || !app.clientSecret) {
    throw new DomainError(
      ErrCode.SCM_APP_NOT_CONFIGURED,
      `${SCM_PROVIDER_META[provider].label} OAuth 应用未配置（系统级与组织级均无）`,
    );
  }
  const state = await issueScmState({ orgId, userId, provider, origin });
  const q = new URLSearchParams({
    response_type: "code",
    client_id: app.clientId,
    redirect_uri: scmCallbackUrl(origin, orgId, provider),
    scope: SCM_PROVIDER_META[provider].scopes,
    state,
  });
  return `${bases.webBase}${SCM_PROVIDER_META[provider].authorizePath}?${q}`;
}

interface TokenExchangeResult {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

async function exchangeToken(
  provider: ScmOauthProvider,
  code: string,
  origin: string,
  orgId: string,
): Promise<{
  app: { clientId: string; clientSecret: string };
  bases: { webBase: string; apiBase: string };
  token: TokenExchangeResult;
}> {
  const { app, bases } = await effectiveScmBases(orgId, provider);
  if (app.source === "none" || !app.clientId || !app.clientSecret) {
    throw new DomainError(ErrCode.SCM_APP_NOT_CONFIGURED, "OAuth 应用未配置或密钥缺失");
  }
  const meta = SCM_PROVIDER_META[provider];
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: app.clientId,
    client_secret: app.clientSecret,
    redirect_uri: scmCallbackUrl(origin, orgId, provider),
  });
  const res = await scmOutboundFetch(`${bases.webBase}${meta.tokenPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      // github token 端点缺省返回 querystring，须显式要 json
      accept: "application/json",
    },
    body,
  });
  if (!res.ok) {
    throw new DomainError(ErrCode.SCM_PROVIDER_ERROR, `平台 token 端点响应 ${res.status}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    created_at?: number;
    error?: unknown;
    error_description?: string;
  };
  if (!json.access_token) {
    throw new DomainError(
      ErrCode.SCM_PROVIDER_ERROR,
      `平台未返回 access_token${json.error_description ? `（${json.error_description}）` : ""}`,
    );
  }
  const expiresAt =
    provider === "gitlab" && typeof json.expires_in === "number"
      ? new Date(((json.created_at ?? Math.floor(Date.now() / 1000)) + json.expires_in) * 1000)
      : null;
  return {
    app,
    bases,
    token: { accessToken: json.access_token, refreshToken: json.refresh_token ?? null, expiresAt },
  };
}

interface ScmUserIdentity {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

async function fetchUserIdentity(
  provider: ScmOauthProvider,
  apiBase: string,
  token: string,
): Promise<ScmUserIdentity> {
  const meta = SCM_PROVIDER_META[provider];
  const url = `${apiBase}${meta.userPath}`;
  const withToken = meta.tokenInQuery
    ? `${url}${url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`
    : url;
  const res = await scmOutboundFetch(withToken, {
    headers: {
      accept: "application/json",
      ...(meta.tokenInQuery ? {} : { authorization: `Bearer ${token}` }),
    },
  });
  if (!res.ok) {
    throw new DomainError(ErrCode.SCM_PROVIDER_ERROR, `平台用户信息端点响应 ${res.status}`);
  }
  const u = (await res.json()) as {
    login?: string;
    username?: string;
    name?: string | null;
    avatar_url?: string | null;
  };
  const login = u.login ?? u.username;
  if (!login) throw new DomainError(ErrCode.SCM_PROVIDER_ERROR, "平台未返回用户登录名");
  return { login, name: u.name ?? null, avatarUrl: u.avatar_url ?? null };
}

/** callback 主流程：state 校验 → 换 token → 拉身份 → upsert scm_accounts（同 org+user+provider 覆盖）。 */
export async function handleScmCallback(
  orgId: string,
  provider: ScmOauthProvider,
  code: string,
  state: string,
): Promise<{ login: string }> {
  const payload = await consumeScmState(state);
  if (payload.orgId !== orgId || payload.provider !== provider) {
    throw new DomainError(ErrCode.SCM_OAUTH_STATE_INVALID, ErrMsgStateInvalid());
  }
  const { bases, token } = await exchangeToken(provider, code, payload.origin, orgId);
  const identity = await fetchUserIdentity(provider, bases.apiBase, token.accessToken);
  const ns = `scm-account:${provider}`;
  await prisma.scmAccount.upsert({
    where: { orgId_userId_provider: { orgId, userId: payload.userId, provider } },
    update: {
      login: identity.login,
      name: identity.name,
      avatarUrl: identity.avatarUrl,
      baseUrl: provider === "gitlab" ? bases.webBase : null,
      tokenEnc: encryptCredential(ns, token.accessToken),
      refreshTokenEnc: token.refreshToken ? encryptCredential(ns, token.refreshToken) : null,
      expiresAt: token.expiresAt,
      scopes: SCM_PROVIDER_META[provider].scopes,
      status: "ACTIVE",
      deletedAt: null,
    },
    create: {
      orgId,
      userId: payload.userId,
      provider,
      login: identity.login,
      name: identity.name,
      avatarUrl: identity.avatarUrl,
      baseUrl: provider === "gitlab" ? bases.webBase : null,
      tokenEnc: encryptCredential(ns, token.accessToken),
      refreshTokenEnc: token.refreshToken ? encryptCredential(ns, token.refreshToken) : null,
      expiresAt: token.expiresAt,
      scopes: SCM_PROVIDER_META[provider].scopes,
      status: "ACTIVE",
    },
  });
  return { login: identity.login };
}

// ── 授权账号管理 ──

export async function listScmAccounts(orgId: string) {
  const rows = await prisma.scmAccount.findMany({
    where: { orgId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, name: true } } },
  });
  return {
    total: rows.length,
    items: rows.map((r) => ({
      id: r.id,
      provider: r.provider as ScmOauthProvider,
      login: r.login,
      name: r.name,
      avatarUrl: r.avatarUrl,
      createdById: r.userId,
      createdByName: r.user.name,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      scopes: r.scopes,
      status: r.status as "ACTIVE" | "EXPIRED" | "REVOKED",
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

async function getAccount(orgId: string, accountId: string) {
  const row = await prisma.scmAccount.findFirst({
    where: { id: accountId, orgId, deletedAt: null },
  });
  if (!row) throw new DomainError(ErrCode.SCM_ACCOUNT_NOT_FOUND, "授权账号不存在或已撤销");
  return row;
}

/** 撤销：授权人本人或 ORG_INTEGRATION:UPDATE（route 层判定后传 canOverride）。 */
export async function revokeScmAccount(
  orgId: string,
  accountId: string,
  userId: string,
  canOverride: boolean,
) {
  const row = await getAccount(orgId, accountId);
  if (row.userId !== userId && !canOverride) {
    throw new DomainError(ErrCode.FORBIDDEN, "仅授权人本人或组织管理员可撤销");
  }
  await prisma.scmAccount.update({
    where: { id: row.id },
    data: { status: "REVOKED", deletedAt: new Date() },
  });
  return { id: row.id };
}

// ── GitLab token 刷新（2h 过期 → rotateGitlabToken 旋转一次） ──

type ScmAccountRow = Awaited<ReturnType<typeof prisma.scmAccount.findFirst>>;

/** 取账号有效 token（gitlab 临近/已过期或 401 后旋转一次）。 */
export async function accountToken(orgId: string, accountId: string): Promise<string> {
  const row = await getAccount(orgId, accountId);
  if (row.status !== "ACTIVE") {
    throw new DomainError(ErrCode.SCM_ACCOUNT_NOT_FOUND, "授权账号已撤销或过期，请重新授权");
  }
  const provider = row.provider as ScmOauthProvider;
  const ns = `scm-account:${provider}`;
  const needsRefresh =
    provider === "gitlab" &&
    (row.expiresAt ? row.expiresAt.getTime() < Date.now() + 60_000 : false);
  if (!needsRefresh) return decryptCredential(ns, row.tokenEnc);
  const refreshed = await rotateGitlabToken(orgId, row);
  return refreshed;
}

/** GitLab refresh_token 旋转（失败 → 40478 引导重新授权）。 */
async function rotateGitlabToken(orgId: string, row: NonNullable<ScmAccountRow>): Promise<string> {
  if (!row.refreshTokenEnc) {
    throw new DomainError(
      ErrCode.SCM_ACCOUNT_NOT_FOUND,
      "授权已过期且无 refresh_token，请重新授权",
    );
  }
  const { app, bases } = await effectiveScmBases(orgId, "gitlab");
  const meta = SCM_PROVIDER_META.gitlab;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: decryptCredential("scm-account:gitlab", row.refreshTokenEnc),
    client_id: app.clientId,
    client_secret: app.clientSecret,
  });
  const res = await scmOutboundFetch(`${bases.webBase}${meta.tokenPath}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  if (!res.ok) {
    throw new DomainError(
      ErrCode.SCM_ACCOUNT_NOT_FOUND,
      `刷新访问令牌失败（平台响应 ${res.status}），请重新授权`,
    );
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    created_at?: number;
  };
  if (!json.access_token) {
    throw new DomainError(ErrCode.SCM_ACCOUNT_NOT_FOUND, "平台未返回新 access_token，请重新授权");
  }
  const ns = "scm-account:gitlab";
  await prisma.scmAccount.update({
    where: { id: row.id },
    data: {
      tokenEnc: encryptCredential(ns, json.access_token),
      refreshTokenEnc: json.refresh_token ? encryptCredential(ns, json.refresh_token) : null,
      expiresAt: new Date(
        ((json.created_at ?? Math.floor(Date.now() / 1000)) + (json.expires_in ?? 7200)) * 1000,
      ),
    },
  });
  return json.access_token;
}

// ── OAuth 选仓列表（平台侧分页聚合 ≤5 页=500 条封顶，keyword 本地过滤，返回 {total,items} 信封） ──

interface AccountRepoItem {
  owner: string;
  repo: string;
  defaultBranch: string | null;
  visibility: "public" | "private" | "internal";
  httpsUrl: string;
  sshUrl: string | null;
}

const MAX_REPO_PAGES = 5;
const PER_PAGE = 100;

export async function listAccountRepos(
  orgId: string,
  accountId: string,
  q: { keyword?: string; page: number; pageSize: number },
) {
  const row = await getAccount(orgId, accountId);
  if (row.status !== "ACTIVE") {
    throw new DomainError(ErrCode.SCM_ACCOUNT_NOT_FOUND, "授权账号已撤销或过期，请重新授权");
  }
  const provider = row.provider as ScmOauthProvider;
  const token = await accountToken(orgId, accountId);
  const { bases } = await effectiveScmBases(orgId, provider);
  const meta = SCM_PROVIDER_META[provider];

  const all: AccountRepoItem[] = [];
  for (let page = 1; page <= MAX_REPO_PAGES; page += 1) {
    const base = `${bases.apiBase}${meta.reposPath}`;
    let url: string;
    if (provider === "github") {
      url = `${base}?visibility=all&per_page=${PER_PAGE}&page=${page}`;
    } else if (provider === "gitlab") {
      url = `${base}?membership=true&per_page=${PER_PAGE}&page=${page}`;
    } else {
      url = `${base}?per_page=${PER_PAGE}&page=${page}`;
    }
    if (meta.tokenInQuery) url = `${url}&access_token=${encodeURIComponent(token)}`;
    const res = await scmOutboundFetch(url, {
      headers: {
        accept: "application/json",
        ...(meta.tokenInQuery ? {} : { authorization: `Bearer ${token}` }),
      },
    });
    if (!res.ok) {
      throw new DomainError(ErrCode.SCM_PROVIDER_ERROR, `平台仓库列表响应 ${res.status}`);
    }
    const items = (await res.json()) as Record<string, unknown>[];
    for (const it of items) {
      const normalized = normalizeRepoItem(provider, it);
      if (normalized) all.push(normalized);
    }
    if (items.length < PER_PAGE) break;
  }
  const keyword = q.keyword?.trim().toLowerCase() ?? "";
  const filtered = keyword
    ? all.filter((x) => `${x.owner}/${x.repo}`.toLowerCase().includes(keyword))
    : all;
  const start = (q.page - 1) * q.pageSize;
  return { total: filtered.length, items: filtered.slice(start, start + q.pageSize) };
}

function normalizeRepoItem(
  provider: ScmOauthProvider,
  it: Record<string, unknown>,
): AccountRepoItem | null {
  const S = (v: unknown): string => (typeof v === "string" ? v : "");
  if (provider === "gitlab") {
    const pwp = S(it.path_with_namespace);
    const [owner, repo] = pwp.split("/").slice(-2);
    if (!owner || !repo) return null;
    const vis = S(it.visibility);
    return {
      owner,
      repo,
      defaultBranch: S(it.default_branch) || null,
      visibility:
        vis === "private" || vis === "internal" ? (vis as "private" | "internal") : "public",
      httpsUrl: S(it.http_url_to_repo),
      sshUrl: S(it.ssh_url_to_repo) || null,
    };
  }
  if (provider === "gitee") {
    const ns = it.namespace as Record<string, unknown> | undefined;
    const owner = S(ns?.path);
    const repo = S(it.path);
    if (!owner || !repo) return null;
    const html = S(it.html_url).replace(/\/$/, "");
    return {
      owner,
      repo,
      defaultBranch: S(it.default_branch) || null,
      visibility: it.private === true ? "private" : "public",
      httpsUrl: html ? `${html}.git` : `https://gitee.com/${owner}/${repo}.git`,
      sshUrl: S(it.ssh_url) || null,
    };
  }
  // github
  const full = S(it.full_name);
  const [owner, repo] = full.split("/");
  if (!owner || !repo) return null;
  return {
    owner,
    repo,
    defaultBranch: S(it.default_branch) || null,
    visibility: it.private === true ? "private" : "public",
    httpsUrl: S(it.clone_url) || `https://github.com/${owner}/${repo}.git`,
    sshUrl: S(it.ssh_url) || null,
  };
}
