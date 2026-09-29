/**
 * CSRF Origin 校验（QA-002；rules/security.md §1.1）：
 * 非幂等方法 + 会话 cookie 请求须同源（Origin/Referer 与 host 一致，x-forwarded-host 优先）。
 * 豁免：Authorization 头（APIKEY/Bearer 非 cookie 认证）；Origin/Referer 缺失放行
 *（第一层防护=SameSite=Lax cookie：跨站 POST 不携带会话 cookie；第二层纵深防御兼容非浏览器客户端）。
 */
export interface CsrfRequestLike {
  method: string;
  hasAuthorization: boolean;
  hasSessionCookie: boolean;
  origin: string | null; // origin 头（缺时用 referer 的值）
  referer: string | null;
  host: string | null; // x-forwarded-host 优先，其次 host
}

/** 是否拒绝（true=403）。 */
export function csrfRejected(req: CsrfRequestLike): boolean {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  if (req.hasAuthorization) return false;
  if (!req.hasSessionCookie) return false;
  const originRaw = req.origin ?? req.referer;
  if (!originRaw) return false;
  let originHost: string;
  try {
    originHost = new URL(originRaw).host;
  } catch {
    return true; // 畸形 Origin 拒绝
  }
  if (!req.host) return true;
  return originHost !== req.host;
}
