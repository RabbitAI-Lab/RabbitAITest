/**
 * 禅道平台插件（INTG-002 §2）：REST（GET 请求型）+ token 会话（60min 缓存，401 失效重登一次）。
 * projectKey 语义 = product id。PATH_INFO 请求型登记延后（INTG-002 §1.4）。
 */
import type { PlatformConfig, IssuePayload, PlatformBug } from "@rabbit/shared";

const TOKEN_TTL_MS = 50 * 60 * 1000; // 提前 10 分钟过期，避免边界 401
let tokenCache: { token: string; expiresAt: number } | null = null;

function base(address: string): string {
  return address.replace(/\/+$/, "");
}

async function login(cfg: PlatformConfig, force = false): Promise<string> {
  if (!force && tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const res = await fetch(`${base(cfg.address)}/api.php/v1/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: cfg.username, password: cfg.password }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("PLATFORM_UNAUTHORIZED: 禅道账号或密码错误");
  }
  if (!res.ok) throw new Error(`禅道登录失败 → ${res.status}`);
  const data = (await res.json()) as { token: string };
  tokenCache = { token: data.token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return data.token;
}

function clearToken(): void {
  tokenCache = null;
}

async function request<T>(
  cfg: PlatformConfig,
  path: string,
  init: { method?: string; body?: unknown; retried?: boolean } = {},
): Promise<T> {
  const token = await login(cfg);
  const doFetch = (t: string) =>
    fetch(`${base(cfg.address)}/api.php/v1${path}`, {
      method: init.method ?? "GET",
      headers: { Token: t, "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });
  let res = await doFetch(token);
  if ((res.status === 401 || res.status === 403) && !init.retried) {
    // token 失效自动重登一次（INTG-002-T3 断言路径）
    clearToken();
    const fresh = await login(cfg, true);
    res = await doFetch(fresh);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error("PLATFORM_UNAUTHORIZED: 禅道凭据失效（重登后仍 401）");
  }
  if (!res.ok) throw new Error(`禅道 ${init.method ?? "GET"} ${path} → ${res.status}`);
  return (await res.json()) as T;
}

interface ZentaoBug {
  id: number;
  title: string;
  status: string;
  lastEditedDate: string;
}

export default function createZentaoPlugin() {
  return {
    platform: "zentao" as const,
    async testConnection(cfg: PlatformConfig) {
      const me = await request<{ realname?: string; account: string }>(cfg, "/user-info");
      return { account: me.realname ?? me.account };
    },
    async createIssue(cfg: PlatformConfig, payload: IssuePayload) {
      const bug = await request<{ id: number }>(cfg, "/bugs", {
        method: "POST",
        body: {
          product: Number(payload.projectKey),
          title: payload.title,
          steps: payload.description,
          type: payload.bugType ?? "codeerror",
          ...translateFields(payload.fields),
        },
      });
      return { platformKey: `#${bug.id}` };
    },
    async updateIssue(cfg: PlatformConfig, platformKey: string, payload: IssuePayload) {
      await request(cfg, `/bugs/${platformKey.replace(/^#/, "")}`, {
        method: "PUT",
        body: { title: payload.title, steps: payload.description, ...translateFields(payload.fields) },
      });
      return { platformKey };
    },
    async syncBugs(cfg: PlatformConfig, projectKey: string, since?: string): Promise<PlatformBug[]> {
      const sinceDate = since ? new Date(since) : undefined;
      const sinceParam = sinceDate ? `&lastEditedDate=${encodeURIComponent(`>=${sinceDate!.toISOString().slice(0, 19)}`)}` : "";
      const res = await request<{ bugs: ZentaoBug[] }>(
        cfg,
        `/bugs?product=${encodeURIComponent(projectKey)}&limit=100${sinceParam}`,
      );
      return res.bugs.map((b) => ({
        platformKey: `#${b.id}`,
        title: b.title,
        status: b.status,
        updatedAt: b.lastEditedDate,
      }));
    },
    fieldMapping() {
      return [
        { localField: "title", platformField: "title", required: true },
        { localField: "description", platformField: "steps", required: false },
      ];
    },
  };
}

/** 自定义字段按禅道字段名直传（INTG-001 §1.2 固定映射口径） */
function translateFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null && v !== undefined) out[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  return out;
}
