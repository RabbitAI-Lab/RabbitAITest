/**
 * plugin-runner 入口（PLUG-001 §4）：HTTP JSON 命令面（仅绑定 127.0.0.1；
 * 传输层与架构文档 gRPC 的偏差登记见 PLUG-001 勘误 1）。
 * 命令：POST /rpc {op: load|unload|call} · GET /health · GET /list
 * 两种启动形态：独立进程（tsx src/index.ts）；web 进程内嵌（import { startRunner }——dev/e2e 默认，
 * 勘误 2：独立进程→内嵌端口隔离，生产独立部署口径经 PLUGIN_RUNNER_URL 保留）。
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadPlugin, unloadPlugin, callPlugin, status } from "./host";
import { registerEchoBuiltin, ECHO_HANDLE } from "./builtins";
import type { PluginHandle } from "./types";

const globalForRunner = globalThis as unknown as { __rabbitRunnerStarted?: boolean };

export function startRunner(): void {
  if (globalForRunner.__rabbitRunnerStarted) return;
  globalForRunner.__rabbitRunnerStarted = true;
  registerEchoBuiltin();

  const app = new Hono();

  app.get("/health", (c) => c.json(status()));
  app.get("/healthz", (c) => c.json(status()));
  app.get("/list", (c) => c.json(status()));

  interface RpcBody {
    op: "load" | "unload" | "call";
    handle?: PluginHandle;
    pluginId?: string;
    dir?: string;
    entry?: string;
    method?: string;
    args?: unknown[];
  }

  app.post("/rpc", async (c) => {
    const body = await c.req.json<RpcBody>().catch(() => null);
    if (!body?.op) return c.json({ code: 70002, message: "命令载荷非法", data: null }, 422);
    try {
      switch (body.op) {
        case "load": {
          if (!body.handle?.pluginId || !body.dir || !body.entry) {
            return c.json({ code: 70002, message: "load 需要 handle/dir/entry", data: null }, 422);
          }
          await loadPlugin(body.handle, body.dir, body.entry);
          return c.json({ code: 0, message: "ok", data: { loaded: true } });
        }
        case "unload": {
          if (!body.pluginId) {
            return c.json({ code: 70002, message: "unload 需要 pluginId", data: null }, 422);
          }
          await unloadPlugin(body.pluginId);
          return c.json({ code: 0, message: "ok", data: { unloaded: true } });
        }
        case "call": {
          if (!body.pluginId || !body.method) {
            return c.json({ code: 70002, message: "call 需要 pluginId/method", data: null }, 422);
          }
          const result = await callPlugin(body.pluginId, body.method, body.args ?? []);
          return c.json({ code: 0, message: "ok", data: result });
        }
        default:
          return c.json({ code: 70002, message: `未知操作 ${String(body.op)}`, data: null }, 422);
      }
    } catch (err) {
      return c.json(
        { code: 70004, message: err instanceof Error ? err.message : String(err), data: null },
        500,
      );
    }
  });

  const port = Number(process.env.PLUGIN_RUNNER_PORT ?? 4010);
  serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
    console.log(`[plugin-runner] listening 127.0.0.1:${info.port} (builtin: ${ECHO_HANDLE.name})`);
  });
}

// 独立进程直接运行时自动启动（tsx src/index.ts / node dist/index.js）
if (process.argv[1]?.includes("plugin-runner")) {
  startRunner();
}
