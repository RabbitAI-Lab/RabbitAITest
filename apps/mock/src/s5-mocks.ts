/**
 * 机器人接收 Mock + Git 平台 Mock（S5 MSG-001/FILE-001 e2e 依赖）。
 * 内存态（单进程足够 e2e）：
 *  - /mock-robot/{dingtalk|wecom|feishu}：接收 webhook POST 并记录（GET /mock-robot/_test/calls 断言、POST clear 清场）
 *  - /api/v1|v3|v4|v5/...：四平台标准 API 前缀（与 web git-adapters 的 apiBase 推导对齐：
 *    e2e 仓库 URL 填 http://127.0.0.1:{mockPort}/qa/testdata 即可命中国内 host 分支）
 */
import { Hono } from "hono";

export interface RobotCall {
  channel: string;
  text: string;
  at: string;
}

export const robotCalls: RobotCall[] = [];

export interface MockGitFile {
  path: string;
  content: string;
}

/** 固定仓库内容：任意 owner/repo @ main（data/ 目录 3 文件 + 根 README） */
const GIT_FILES: MockGitFile[] = [
  { path: "README.md", content: "# testdata\nmock git repo for e2e\n" },
  { path: "data/users_small.csv", content: "id,name\n1,alice\n2,bob\n3,carol\n" },
  {
    path: "data/users_large.csv",
    content:
      "id,name\n" + Array.from({ length: 50 }, (_, i) => `${i + 1},user${i + 1}`).join("\n") + "\n",
  },
  { path: "data/city.json", content: '{"city":"shanghai","pop":25000000}\n' },
];

export function buildRobotMocks(): Hono {
  const app = new Hono();

  const record =
    (channel: string) =>
    async (c: {
      req: { json: () => Promise<unknown> };
      json: (b: unknown, s?: 200) => Response;
    }) => {
      const body = (await c.req.json().catch(() => ({}))) as {
        text?: { content?: string };
        content?: { text?: string };
      };
      const text = body?.text?.content ?? body?.content?.text ?? "";
      robotCalls.push({ channel, text, at: new Date().toISOString() });
      return c.json({ errcode: 0 });
    };

  app.post("/dingtalk", (c) => record("dingtalk")(c));
  app.post("/wecom", (c) => record("wecom")(c));
  app.post("/feishu", (c) => record("feishu")(c));

  app.get("/_test/calls", (c) => c.json({ total: robotCalls.length, items: [...robotCalls] }));
  app.post("/_test/clear", (c) => {
    robotCalls.length = 0;
    return c.json({ ok: true });
  });
  return app;
}

export function buildGitMocks(): Hono {
  const app = new Hono();

  const contentsEntry = (f: MockGitFile) => ({
    name: f.path.split("/").pop() ?? f.path,
    path: f.path,
    type: "file",
    size: Buffer.byteLength(f.content, "utf8"),
    content: Buffer.from(f.content, "utf8").toString("base64"),
    encoding: "base64",
    download_url: `/mock-git-raw/${f.path}`,
  });

  const dirEntries = (dir: string) => {
    const prefix = dir.replace(/\/+$/, "") + "/";
    const seen = new Set<string>();
    const out: { name: string; path: string; type: string }[] = [];
    for (const f of GIT_FILES) {
      if (!f.path.startsWith(prefix)) continue;
      const rest = f.path.slice(prefix.length);
      if (rest.includes("/")) {
        const sub = rest.split("/")[0] ?? "";
        if (sub && !seen.has(sub)) {
          seen.add(sub);
          out.push({ name: sub, path: prefix + sub, type: "dir" });
        }
      } else {
        out.push({ name: rest, path: f.path, type: "file" });
      }
    }
    return out;
  };

  // ── gitea(/api/v1) / github-enterprise(/api/v3) / gitee(/api/v5)：contents 族同形 ──
  // repo 元信息（连接测试探活端点：{apiBase}/repos/{owner}/{repo}）
  app.get("/api/v1/repos/:owner/:repo", (c) =>
    c.json({ id: 1, full_name: `${c.req.param("owner")}/${c.req.param("repo")}` }),
  );
  app.get("/api/v3/repos/:owner/:repo", (c) => c.json({ id: 1, full_name: "qa/testdata" }));
  app.get("/api/v5/repos/:owner/:repo", (c) => c.json({ id: 1, full_name: "qa/testdata" }));
  const contentsHandler = (c: {
    req: { path: string };
    json: (b: unknown, s?: number) => Response;
  }) => {
    const m = c.req.path.match(/\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    const target = (m?.[1] ?? "").split("?")[0];
    const file = GIT_FILES.find((f) => f.path === target);
    if (file) return c.json(contentsEntry(file));
    const entries = dirEntries(target || "");
    if (entries.length > 0) {
      return c.json(
        entries.map((e) =>
          e.type === "file"
            ? contentsEntry(
                GIT_FILES.find((f) => f.path === e.path) ?? { path: e.path, content: "" },
              )
            : e,
        ),
      );
    }
    return c.json({ message: "Not Found" }, 404);
  };

  app.get("/api/v1/repos/*", (c) => contentsHandler(c));
  app.get("/api/v3/repos/*", (c) => contentsHandler(c));
  app.get("/api/v5/repos/*", (c) => contentsHandler(c));

  // ── gitlab(/api/v4)：tree + raw ──
  app.get("/api/v4/projects/:pid", (c) => c.json({ id: 1, path_with_namespace: "qa/testdata" }));
  app.get("/api/v4/projects/:pid/repository/tree", (c) => {
    const path = c.req.query("path") ?? "";
    const entries = dirEntries(path).map((e) => ({
      type: e.type === "dir" ? "tree" : "blob",
      path: e.path,
    }));
    if (entries.length === 0) return c.json({ message: "404 Tree Not Found" }, 404);
    return c.json(entries);
  });
  app.get("/api/v4/projects/:pid/repository/files/:path/raw", (c) => {
    const decoded = decodeURIComponent(c.req.param("path"));
    const file = GIT_FILES.find((f) => f.path === decoded);
    if (!file) return c.text("404 File Not Found", 404);
    return c.text(file.content);
  });

  // download_url 兜底（contents 族 download_url 分支）
  app.get("/mock-git-raw/*", (c) => {
    const target = c.req.path.replace(/^\/mock-git-raw\//, "");
    const file = GIT_FILES.find((f) => f.path === target);
    if (!file) return c.text("404", 404);
    return c.text(file.content);
  });

  return app;
}
