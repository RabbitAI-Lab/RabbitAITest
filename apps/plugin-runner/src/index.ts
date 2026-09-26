import { serve } from "@hono/node-server";
import { Hono } from "hono";

/** 插件宿主占位（Sprint 6 PLUG-001 落地 worker_threads 隔离加载）。 */
const app = new Hono();
app.get("/healthz", (c) => c.json({ status: "UP", plugins: [] }));

serve({ fetch: app.fetch, port: Number(process.env.PLUGIN_RUNNER_PORT ?? 4010) }, (info) => {
  console.log(`[plugin-runner] listening :${info.port}`);
});
