import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import Redis from "ioredis";
import type { MockProjectSnapshot, MockRuleSnapshotItem } from "@rabbit/shared";
import { buildPlatformMocks, mountSwaggerDoc } from "./platform-mocks.js";

/**
 * Mock 服务（API-005）：`/mock/{projectNum}/{...apiPath}` 规则匹配。
 * 规则来源=web 写入 Redis 的项目全量快照（engine-execution-architecture §6）；
 * 本服务无 DB、无状态——每次请求直读快照（本地 Redis 亚毫秒，天然热更新），可横向扩容。
 */
export const app = new Hono();
const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

app.get("/healthz", (c) => c.json({ status: "UP" }));
app.get("/hello", (c) => c.json({ message: "hello", status: "UP" }));

// ── 性能基准回显（S8 QA-001 场景 C 采样目标；零延迟回显，排除外网抖动）──
const perfEcho = async (c: Context) => {
  let body: unknown = null;
  try {
    body = await c.req.json();
  } catch {
    body = null;
  }
  return c.json({ echo: true, method: c.req.method, path: c.req.path, body, ts: Date.now() });
};
app.get("/perf/echo", perfEcho);
app.post("/perf/echo", perfEcho);
// 其余方法 404（Hono 默认）——QA-001-T2 jmx 405/404 变体断言用

// ── AI 供应商 Mock（S7 AI-001~005 测试确定性出口；OpenAI 兼容 chat/completions）──
// 分支依据=真实 system prompt 固定开头（shared 常量，生产代码零测试标记）：
//   「测试用例生成助手」→ 2 条固定功能用例草稿 JSON；「接口用例生成助手」→ 1 条固定接口用例草稿；
//   「智能助手」→ 3 片流式聊天文本；连通探测（Reply with exactly: pong）→ pong
const MOCK_CASE_GEN_JSON = JSON.stringify([
  {
    name: "密码错误 5 次后锁定账户",
    prerequisite: "已注册且未锁定的用户",
    steps: [
      { desc: "连续输错密码 5 次", expect: "提示「账户已锁定」" },
      { desc: "锁定期间输入正确密码", expect: "仍拒绝登录" },
      { desc: "等待 30 分钟后登录", expect: "成功进入工作台" },
    ],
    level: "high",
    tags: ["安全", "登录"],
  },
  {
    name: "锁定到期自动解锁",
    prerequisite: "处于锁定态的账户",
    steps: [
      { desc: "锁定剩余 1 分钟时尝试登录", expect: "拒绝并提示剩余时长" },
      { desc: "锁定期满后登录", expect: "成功" },
    ],
    level: "medium",
    tags: ["登录"],
  },
]);
const MOCK_API_CASE_JSON = JSON.stringify([
  {
    name: "创建订单 · 正向主路径",
    request: { bodyJson: '{"skuId":"SKU-001","qty":1}' },
    assertions: [
      { source: "status", expression: "", operator: "eq", expected: "200" },
      { source: "body", expression: "$.code", operator: "eq", expected: "0" },
      { source: "body", expression: "$.data.orderId", operator: "exists", expected: "" },
    ],
  },
]);
const MOCK_CHAT_TEXT =
  "可以从三层设计：1. 边界值：第 4 次（未触发）与第 5 次（触发锁定）各一条；2. 锁定期间行为：正确密码也不放行；3. 时间边界：30 分钟整自动解锁。";

app.post("/ai/chat/completions", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    stream?: boolean;
    messages?: { role: string; content: string }[];
  };
  const system = body.messages?.find((m) => m.role === "system")?.content ?? "";
  let content: string;
  if (system.includes("测试用例生成助手")) content = MOCK_CASE_GEN_JSON;
  else if (system.includes("接口用例生成助手")) content = MOCK_API_CASE_JSON;
  else if (system.includes("pong")) content = "pong";
  else content = MOCK_CHAT_TEXT;
  const mockModel = "mock-e2e-model";
  if (body.stream) {
    // 3 片 delta + [DONE]（打字机断言依赖）
    const parts = content.match(/[\s\S]{1,12}/g) ?? [content];
    const chunks = parts.map(
      (text, i) =>
        `data: ${JSON.stringify({ id: `mock-${i}`, model: mockModel, choices: [{ index: 0, delta: { content: text } }] })}\n\n`,
    );
    chunks.push("data: [DONE]\n\n");
    return new Response(chunks.join(""), {
      headers: { "content-type": "text/event-stream; charset=utf-8", "x-mock-ai": "1" },
    });
  }
  return c.json({
    id: "mock-chatcmpl",
    model: mockModel,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  });
});

interface MatchedRule {
  rule: MockRuleSnapshotItem;
  restParams: Record<string, string>;
  score: number;
}

/** 路径模板匹配：`/pets/{id}` → `/pets/9`（捕获 REST 参数）。 */
export function matchPath(template: string, path: string): Record<string, string> | undefined {
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
  req: {
    method: string;
    path: string;
    query: Record<string, string>;
    headers: Record<string, string>;
    body: string;
  },
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
  // S6 INTG e2e：三方平台 mock 挂载（/mock-jira /mock-zentao... 经 basePath 前缀路由到同一组处理器）
  const platformMocks = buildPlatformMocks();
  app.route("/mock-jira", platformMocks);
  app.route("/mock-zentao", platformMocks);
  app.route("/mock-tapd", platformMocks);
  // S5 MSG-001/FILE-001 e2e：机器人 webhook 接收 + Git 平台（标准 API 前缀 /api/v1|v3|v4|v5）
  const { buildRobotMocks, buildGitMocks } = await import("./s5-mocks.js");
  app.route("/mock-robot", buildRobotMocks());
  // S9 ENTP-002/003 e2e/jmx：SSO+扫码 mock IdP（/sso/{provider}/{authId}/authorize|token|userinfo + serviceValidate + _test 控面）
  const { buildSsoMocks } = await import("./s9-sso-mocks.js");
  app.route("/sso", buildSsoMocks());
  app.route("/", buildGitMocks());
  mountSwaggerDoc(app);
  // S11 UIT-002：/uit/demo UI 测试演示页（输入框+按钮+动态文案，无鉴权）
  const { mountUitDemo } = await import("./uit-demo.js");
  mountUitDemo(app);
  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(
      `[mock] listening :${info.port}（/healthz /hello /mock/{projectNum}/{path} + mock-jira/zentao/tapd + mock-robot + git-api + sso-idp + ws-echo + uit-demo）`,
    );
  });
  // S-future PLUG-003：/ws/echo WebSocket 回显（协议插件 e2e 采样目标）
  const { mountWsEcho } = await import("./ws-echo.js");
  mountWsEcho(server);
}
