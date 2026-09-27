/** API-004 kernel：变量渲染 + 环境域名解析 + HOST 映射（纯函数，单测覆盖）。 */
import type { EnvHttpDomain, EnvSnapshot, RequestSpec } from "@rabbit/shared/execution";

export interface RenderContext {
  vars: Record<string, string>;
  env: EnvSnapshot | undefined;
  moduleId: string | undefined; // 域名条件：模块匹配
}

const VAR_RE = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

/** 作用域链 临时 > 任务参数 > 环境变量 > 全局参数（合并已在 web 快照侧完成，此处=vars 单表）。 */
export function renderString(input: string, vars: Record<string, string>): string {
  return input.replace(VAR_RE, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? (vars[name] ?? whole) : whole,
  );
}

export function renderRequest(spec: RequestSpec, ctx: RenderContext): RequestSpec {
  const r = (s: string) => renderString(s, ctx.vars);
  return {
    ...spec,
    url: r(spec.url),
    headers: spec.headers.map((h) => ({ ...h, value: r(h.value) })),
    query: spec.query.map((q) => ({ ...q, value: r(q.value) })),
    body:
      "content" in spec.body
        ? { ...spec.body, content: r(spec.body.content) }
        : "rows" in spec.body
          ? {
              ...spec.body,
              rows: spec.body.rows.map((row) => ({ ...row, value: r(row.value) })),
            }
          : spec.body,
    auth:
      "username" in spec.auth
        ? { ...spec.auth, username: r(spec.auth.username), password: r(spec.auth.password) }
        : spec.auth,
  };
}

/** 域名条件匹配优先级：路径前缀 > 模块 > 默认（PROJ-003 §1.2）。 */
export function pickDomain(
  requestPath: string,
  moduleId: string | undefined,
  http: EnvHttpDomain[],
): EnvHttpDomain | undefined {
  let best: { d: EnvHttpDomain; score: number } | undefined;
  for (const d of http) {
    let score = 0;
    const cond = d.conditions ?? {};
    if (cond.pathPrefix && requestPath.startsWith(cond.pathPrefix)) score += 4;
    if (cond.moduleId && cond.moduleId === moduleId) score += 2;
    if (score === 0 && !cond.pathPrefix && !cond.moduleId) score = 1; // 无条件=默认兜底
    if (score > 0 && (!best || score > best.score)) best = { d, score };
  }
  return best?.d;
}

/** 相对路径 → 绝对 URL（query 拼接在此一并完成）。 */
export function resolveUrl(spec: RequestSpec, ctx: RenderContext): string {
  let url = spec.url;
  const isAbsolute = /^https?:\/\//i.test(url);
  if (!isAbsolute) {
    const d = ctx.env ? pickDomain(url.split("?")[0] ?? url, ctx.moduleId, ctx.env.http) : undefined;
    if (!d) {
      const err = new Error("相对路径请求未选择环境（无可用域名配置）") as Error & { kind: "CONFIG" };
      err.kind = "CONFIG";
      throw err;
    }
    const port =
      (d.protocol === "http" && d.port === 80) || (d.protocol === "https" && d.port === 443)
        ? ""
        : `:${d.port}`;
    url = `${d.protocol}://${d.hostname}${port}${d.pathPrefix ?? ""}${url.startsWith("/") ? url : `/${url}`}`;
  }
  const enabledQuery = spec.query.filter((q) => q.enabled);
  if (enabledQuery.length === 0) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${enabledQuery.map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`).join("&")}`;
}

/** HOST 映射表（host → address；连接重定向，Host 头不变）。 */
export function hostsMap(env: EnvSnapshot | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const h of env?.hosts ?? []) m.set(h.host, h.address);
  return m;
}

/** 合并环境全局与请求级编排：全局前置插最前、全局断言/提取追加（API-004 §2 管线）。 */
export function mergeGlobals<T>(envList: T[] | undefined, own: T[]): T[] {
  return [...(envList ?? []), ...own];
}
