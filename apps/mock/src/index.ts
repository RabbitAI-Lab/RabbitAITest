import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import Redis from "ioredis";
import type { MockProjectSnapshot, MockRuleSnapshotItem } from "@rabbit/shared";

/**
 * Mock 服务（API-005）：`/mock/{projectNum}/{...apiPath}` 规则匹配。
 * 规则来源=web 写入 Redis 的项目全量快照（engine-execution-architecture §6）；
 * 本服务无 DB、无状态——每次请求直读快照（本地 Redis 亚毫秒，天然热更新），可横向扩容。
 */
const app = new Hono();
const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

app.get("/healthz", (c) => c.json({ status: "UP" }));
app.get("/hello", (c) => c.json({ message: "hello", status: "UP" }));

interface MatchedRule {
  rule: MockRuleSnapshotItem;
  restParams: Record<string, string>;
  score: number;
}

/** 路径模板匹配：`/pets/{id}` → `/pets/9`（捕获 REST 参数）。 */
export function matchPath(
  template: string,
  path: string,
): Record<string, string> | undefined {
  const t = template.split("/").filter(Boolean);
  const p = path.split("/").filter(Boolean);
  if (t.length !== p.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < t.length; i++) {
    const seg = t[i] ?? "";
    if (seg.startsWith("{") && seg.endsWith("}")) {
      const val = p[i] ?? "";
      if (!val) return undefined;
      params[seg.slice(1, -1)] = val;
    } else if (seg !== (p[i] ?? "")) {
      return undefined;
    }
  }
  return params;
}

/** 规则匹配：method+path 模板 → 头/Query/体条件全过 → 条件最多者优先（API-005 §2）。 */
export function pickRule(
  rules: MockRuleSnapshotItem[],
  req: { method: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: string },
): MatchedRule | undefined {
  let best: MatchedRule | undefined;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.method.toUpperCase() !== req.method.toUpperCase()) continue;
    const restParams = matchPath(rule.pathTemplate, req.path);
    if (restParams === undefined) continue;
    let score = 0;
    let ok = true;
    for (const q of rule.matchers.query) {
      score += 1;
      if (req.query[q.key] !== q.value) ok = false;
    }
    for (const h of rule.matchers.headers) {
      score += 1;
      if ((req.headers[h.key.toLowerCase()] ?? "") !== h.value) ok = false;
    }
    if (rule.matchers.bodyContains !== undefined && rule.matchers.bodyContains !== "") {
      score += 1;
      if (!req.body.includes(rule.matchers.bodyContains)) ok = false;
    }
    if (!ok) continue;
    if (!best || score > best.score) best = { rule, restParams, score };
  }
  return best;
}

async function loadSnapshot(projectId: string): Promise<MockProjectSnapshot | undefined> {
  try {
    await redis.connect().catch(() => {});
    const raw = await redis.get(`mock:rules:${projectId}`);
    if (!raw) return undefined;
    return JSON.parse(raw) as MockProjectSnapshot;
  } catch {
    return undefined;
  }
}

app.all("/mock/:projectNum/*", async (c: Context) => {
  const projectNum = c.req.param("projectNum");
  const apiPath = c.req.path.replace(/^\/mock\/[^/]+/, "") || "/";
  let projectId: string | null = null;
  try {
    await redis.connect().catch(() => {});
    projectId = await redis.get(`mock:proj:${projectNum}`);
  } catch {
    projectId = null;
  }
  const noMatch = (message: string) => c.json({ code: 40401, message, data: null }, 404);
  if (!projectId) return noMatch("无匹配 Mock 规则（项目未发布 Mock 快照）");
  const snapshot = await loadSnapshot(projectId);
  if (!snapshot) return noMatch("无匹配 Mock 规则（快照不存在）");

  const body = await c.req.raw.text().catch(() => "");
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.req.query())) query[k] = v;
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((v, k) => (headers[k] = v));

  const matched = pickRule(snapshot.rules, {
    method: c.req.method,
    path: apiPath,
    query,
    headers,
    body,
  });
  if (!matched) return noMatch("无匹配 Mock 规则");

  const resp = matched.rule.followApi
    ? {
        status: matched.rule.apiResponse.status,
        headers: matched.rule.apiResponse.headers,
        body: matched.rule.apiResponse.body,
        delayMs: matched.rule.response.delayMs,
      }
    : matched.rule.response;
  if (resp.delayMs > 0) {
    await new Promise((r) => setTimeout(r, Math.min(resp.delayMs, 10000)));
  }
  const h = new Headers();
  for (const { key, value } of resp.headers ?? []) h.set(key, value);
  if (!h.has("content-type")) h.set("content-type", "application/json; charset=utf-8");
  h.set("x-mock-rule", matched.rule.id);
  return new Response(resp.body ?? "", { status: resp.status, headers: h });
});

const port = Number(process.env.MOCK_PORT ?? 4000);
if (process.env.VITEST === undefined) {
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[mock] listening :${info.port}（/healthz /hello /mock/{projectNum}/{path}）`);
  });
}
