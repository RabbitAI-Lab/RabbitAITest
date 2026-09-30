/**
 * SYS-009：OAuth Token 通道契约（Device Flow）——scope 模型 / exec 路由注册表 / TTL 常量 / 端点载荷。
 * 单一来源：服务端守卫与 CLI-001（cmd_auth.go 契约对端）共同引用的语义都在这里。
 */
import { z } from "zod";

// ── TTL（秒）：device code 10 分钟 / access 2h / refresh 30d / 轮询间隔 5s（RFC 8628） ──
export const OAUTH_DEVICE_CODE_TTL = 600;
export const OAUTH_ACCESS_TTL = 7200;
export const OAUTH_REFRESH_TTL = 30 * 24 * 3600;
export const OAUTH_POLL_INTERVAL = 5;

export const OAUTH_CLIENT_ID = "rabbit-cli";
export const ACCESS_TOKEN_PREFIX = "rat_";
export const REFRESH_TOKEN_PREFIX = "rrt_";

/** user_code 字符集：去元音/去混淆（0/O/1/I/L/N/S/U/V/Z/W 等） */
export const USER_CODE_CHARSET = "BCDFGHJKMPQRTVWXY2346789";

export type OAuthScope = "read" | "write" | "exec";
const SCOPE_VALUES: readonly string[] = ["read", "write", "exec"];

/**
 * scope 解析（逗号/空白分隔）：空→缺省 read（最小权限缺省）；含非法值→null（调用方回 invalid_scope）。
 * Token 的 scope 只是收窄，RBAC 权限点照常校验——最终权限 = 角色权限点 ∩ scope（SYS-009 §2.3）。
 */
export function parseScope(raw: string | undefined | null): OAuthScope[] | null {
  const list = (raw ?? "").split(/[\s,]+/).filter(Boolean);
  const scopes = list.length > 0 ? list : ["read"];
  const set = new Set<OAuthScope>();
  for (const s of scopes) {
    if (!SCOPE_VALUES.includes(s)) return null;
    set.add(s as OAuthScope);
  }
  return [...set];
}

/**
 * exec 路由注册表：[method, pattern]，{seg}=路径段通配。
 * exec 动作（触发执行/停止/重跑）的权限点散在 CREATE/UPDATE 上，无法从权限点后缀推导，显式登记（SYS-009 §2.3）。
 * 新增执行端点须同步登记并补单测（requiredScopeFor 矩阵）。
 */
export const EXEC_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ["POST", "/api/v1/projects/{p}/exec-tasks"],
  ["POST", "/api/v1/projects/{p}/exec-tasks/{t}/rerun"],
  ["POST", "/api/v1/projects/{p}/exec-tasks/{t}/stop"],
  ["POST", "/api/v1/projects/{p}/apis/{a}/cases/execute"],
  ["POST", "/api/v1/projects/{p}/scenarios/execute"],
  ["POST", "/api/v1/projects/{p}/scenarios/{id}/execute"],
  ["POST", "/api/v1/projects/{p}/scenarios/{id}/steps/{s}/execute"],
  ["POST", "/api/v1/projects/{p}/plans/{planId}/execute"],
  ["POST", "/api/v1/projects/{p}/plans/{planId}/cases/batch-executor"],
  ["POST", "/api/v1/projects/{p}/plans/{planId}/cases/{r}/exec"],
  ["POST", "/api/v1/projects/{p}/plans/{planId}/cases/{r}/run"],
  ["POST", "/api/v1/projects/{p}/scenario-schedules/{id}/run"],
  ["POST", "/api/v1/open/exec/{leaf}"],
];

function routeMatches(pattern: string, path: string): boolean {
  const p = pattern.split("/");
  const t = path.split("/");
  if (p.length !== t.length) return false;
  return p.every((seg, i) => seg.startsWith("{") || seg === t[i]);
}

/** 所需 scope 判定：exec 注册表命中 → exec；否则 GET/HEAD → read，其余 → write。守卫层统一调用。 */
export function requiredScopeFor(method: string, path: string): OAuthScope {
  const m = method.toUpperCase();
  if (EXEC_ROUTES.some(([rm, pat]) => rm === m && routeMatches(pat, path))) return "exec";
  return m === "GET" || m === "HEAD" ? "read" : "write";
}

// ── 端点载荷 ──
// approve 走平台信封（session 通道）；device/code 与 token 走 RFC 8628 原生形状（api-conventions 例外登记），
// 故无 zod schema——形状由 oauth.service 保证并经 jmx/e2e 冻结。

export const oauthApproveSchema = z.object({
  userCode: z.string().trim().min(8).max(9), // XXXX-XXXX（含连字符 9 位；内部码 8 位）
  approve: z.boolean(),
});
export type OAuthApproveInput = z.infer<typeof oauthApproveSchema>;

/** user_code 规范化：大写+去连字符/空白（库内统一 8 位裸码） */
export function normalizeUserCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
