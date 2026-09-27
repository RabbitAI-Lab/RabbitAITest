/**
 * 三方平台 Mock（S6 INTG-001/002 e2e 依赖）：Jira / 禅道 / TAPD 最小面。
 * 内存态（单进程足够 e2e；数据隔离=每 mock 平台独立 workspace/project 前缀）。
 * 凭据口径：e2e 用户名/密码=mock-user/mock-pass（测试夹具值，非真实凭据——rules/security）。
 */
import { Hono } from "hono";

export interface MockIssue {
  key: string;
  summary: string;
  description: string;
  status: string; // jira: In Progress/done/closed；zentao: active/resolved/closed；tapd: resolved/rejected/closed
  updatedAt: string;
}

/** 状态推进序列：同步测试两态（resolved 回写）用 */
export const platformState = new Map<string, MockIssue>();
let seq = 1000;

function notFound(c: { json: (b: unknown, s: 404) => Response }, msg: string) {
  return c.json({ error: msg }, 404);
}

export function buildPlatformMocks(): Hono {
  const app = new Hono();

  // ── Jira（REST v2 子集）──
  app.get("/rest/api/2/myself", (c) => {
    if (c.req.header("authorization")?.includes("Zm9vOmJhcg==")) return c.json({ errorMessages: ["Unauthorized"] }, 401);
    return c.json({ displayName: "Mock Jira User", emailAddress: "mock-jira@example.com" });
  });
  app.post("/rest/api/2/issue", async (c) => {
    const body = (await c.req.json()) as { fields: { project: { key: string }; summary: string; description: string } };
    seq += 1;
    const key = `${body.fields.project.key}-${seq}`;
    platformState.set(key, {
      key,
      summary: body.fields.summary,
      description: body.fields.description,
      status: "in progress",
      updatedAt: new Date().toISOString(),
    });
    return c.json({ key, id: String(seq) }, 201);
  });
  app.put("/rest/api/2/issue/:key", async (c) => {
    const key = c.req.param("key");
    const body = (await c.req.json()) as { fields: { summary: string; description: string } };
    const issue = platformState.get(key);
    if (!issue) return c.json({ error: "issue not found" }, 404);
    issue.summary = body.fields.summary;
    issue.updatedAt = new Date().toISOString();
    return c.body(null, 204) as unknown as Response;
  });
  app.get("/rest/api/2/search", (c) => {
    const jql = c.req.query("jql") ?? "";
    const projectKey = /project\s*=\s*"([^"]+)"/.exec(jql)?.[1] ?? "";
    const issues = [...platformState.values()].filter((i) => i.key.startsWith(`${projectKey}-`));
    return c.json({
      issues: issues.map((i) => ({ key: i.key, fields: { summary: i.summary, status: { name: i.status === "in progress" ? "In Progress" : i.status }, updated: i.updatedAt } })),
    });
  });

  // ── 禅道（REST v1 子集：token + bugs）──
  let zentaoToken: { token: string; at: number } | null = null;
  app.post("/api.php/v1/tokens", async (c) => {
    const body = (await c.req.json()) as { account: string; password: string };
    if (body.account && body.password) {
      // 非空即过（e2e/CI 凭据经 env 注入；mock 不承载真实鉴权语义——rules/security 测试凭据纪律）
      zentaoToken = { token: `zt-${Date.now()}`, at: Date.now() };
      return c.json({ token: zentaoToken.token }, 201);
    }
    return c.json({ error: "auth failed" }, 401);
  });
  function zentaoAuthed(c: { req: { header: (k: string) => string | undefined } }): boolean {
    const t = c.req.header("Token");
    return Boolean(t && zentaoToken && t === zentaoToken.token);
  }
  app.get("/api.php/v1/user-info", (c) => {
    if (!zentaoAuthed(c)) return c.json({ error: "unauthorized" }, 401);
    return c.json({ account: "mock-user", realname: "禅道 Mock 用户" });
  });
  app.post("/api.php/v1/bugs", async (c) => {
    if (!zentaoAuthed(c)) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json()) as { product: number; title: string };
    seq += 1;
    const key = `#${seq}`;
    platformState.set(key, {
      key,
      summary: body.title,
      description: "",
      status: "active",
      updatedAt: new Date().toISOString(),
    });
    return c.json({ id: seq }, 201);
  });
  app.get("/api.php/v1/bugs", (c) => {
    if (!zentaoAuthed(c)) return c.json({ error: "unauthorized" }, 401);
    const product = c.req.query("product") ?? "";
    const bugs = [...platformState.values()].filter((i) => i.key.startsWith("#"));
    return c.json({ bugs: bugs.map((b) => ({ id: Number(b.key.slice(1)), title: b.summary, status: b.status, lastEditedDate: b.updatedAt, product: Number(product) || 1 })) });
  });

  // ── TAPD（v1 子集：Basic Auth + bugs）──
  app.get("/quickstart/testauth", (c) => {
    const auth = c.req.header("authorization") ?? "";
    const decoded = Buffer.from(auth.replace("Basic ", ""), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    // 非空用户名+密码即过（同 zentao 口径：mock 不承载真实鉴权）
    if (idx > 0 && decoded.slice(0, idx) && decoded.slice(idx + 1)) {
      return c.json({ status: 1, data: { user: "tapd-mock", email: "tapd@example.com" } });
    }
    return c.json({ status: -1, info: "auth failed" }, 401);
  });
  app.post("/bugs", async (c) => {
    const body = (await c.req.json()) as { workspace_id: string; title: string };
    seq += 1;
    const key = `tapd-${seq}`;
    platformState.set(key, {
      key,
      summary: body.title,
      description: "",
      status: "new",
      updatedAt: new Date().toISOString(),
    });
    return c.json({ status: 1, data: { Bug: { id: String(seq) } } });
  });
  app.get("/bugs", (c) => {
    const workspace = c.req.query("workspace_id") ?? "";
    const data = [...platformState.values()]
      .filter((i) => i.key.startsWith("tapd-"))
      .map((i) => ({ Bug: { id: i.key.slice(5), title: i.summary, status: i.status, modified: i.updatedAt, workspace_id: workspace } }));
    return c.json({ status: 1, data });
  });

  // ── 测试控制面（e2e 注入状态变更：模拟平台侧流转）──
  app.post("/_test/set-status", async (c) => {
    const { key, status } = (await c.req.json()) as { key: string; status: string };
    const issue = platformState.get(key);
    if (!issue) return notFound(c, "not found");
    issue.status = status;
    issue.updatedAt = new Date().toISOString();
    return c.json({ ok: true });
  });

  return app;
}

/** Swagger 定时同步 mock 文档（API-011）：挂主 app 根级（不经平台前缀） */
export function mountSwaggerDoc(app: Hono): void {
  app.get("/docs/openapi.json", (c) => {
    return c.json({
      openapi: "3.0.3",
      info: { title: "Mock Order API", version: "1.0.0" },
      paths: {
        "/orders": {
          get: { summary: "list orders", responses: { "200": { description: "ok" } } },
          post: { summary: "create order", responses: { "201": { description: "created" } } },
        },
        "/orders/{orderId}": {
          get: { summary: "get order", responses: { "200": { description: "ok" } } },
        },
      },
    });
  });
}
