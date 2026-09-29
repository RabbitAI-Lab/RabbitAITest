/* 一次性：补拍 reports.png。复用仍在运行的 web:3199/mock:4099/redis:6399，仅重启 PG:5455（数据目录持久）。 */
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(process.cwd());
const WEB_URL = "http://127.0.0.1:3199";
const MOCK_URL = "http://127.0.0.1:4099/hello";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await new Promise((resolve) => {
      const s = net.connect(port, "127.0.0.1");
      s.once("connect", () => { s.destroy(); resolve(true); });
      s.once("error", () => { s.destroy(); resolve(false); });
    });
    if (ok) return;
    if (Date.now() > deadline) throw new Error(`port ${port} timeout`);
    await sleep(300);
  }
}

const pgUp = await waitPort(5455, 800).then(() => true).catch(() => false);
if (!pgUp) {
  const mod = await import("embedded-postgres");
  const EP = mod.default ?? mod.EmbeddedPostgres ?? mod;
  const pg = new EP({ databaseDir: path.join(root, ".pgdata-portal"), user: "postgres", password: "postgres", port: 5455, persistent: true });
  await pg.start();
  await waitPort(5455);
  console.log("[shot] pg :5455 up（本脚本启动）");
} else {
  console.log("[shot] pg :5455 已在运行，复用");
}

const { chromium } = await import("@playwright/test");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: WEB_URL });
const page = await ctx.newPage();

const email = `portal-${Date.now()}@rabbit.test`;
const reg = await ctx.request.post("/api/v1/auth/register", { data: { email, password: "rabbit-pass-123" } });
if (reg.status() !== 201) throw new Error(`注册失败 ${reg.status()}: ${await reg.text()}`);
const { data: regData } = await reg.json();
const ras = (reg.headers()["set-cookie"] ?? "").split("ras=")[1]?.split(";")[0];
if (ras) await ctx.addCookies([{ name: "ras", value: ras, url: WEB_URL }]);
const pid = regData.projectId;
console.log("[shot] registered, project", pid);

const task = await ctx.request.post(`/api/v1/projects/${pid}/exec-tasks`, {
  data: {
    type: "api_debug",
    request: { method: "GET", url: MOCK_URL, headers: [], query: [], body: { kind: "none" }, auth: { kind: "none" }, timeoutMs: 10000, followRedirects: false, skipPre: false, skipPost: false },
    asserts: [{ kind: "status_code", path: "", op: "eq", expected: "200" }],
    pre: [], post: [], extracts: [],
  },
});
if (task.status() !== 201) throw new Error(`建任务失败 ${task.status()}`);

// 先经 API 轮询报告终态（列表页不自动刷新，须终态后再进入）
for (let i = 0; i < 60; i++) {
  const r = await ctx.request.get(`/api/v1/projects/${pid}/reports`);
  const items = (await r.json())?.data?.items ?? [];
  if (items.some((it) => it.taskStatus === "SUCCESS")) break;
  if (i === 59) throw new Error("报告未在 60s 内到达 SUCCESS");
  await sleep(1000);
}
console.log("[shot] 报告已 SUCCESS，进列表页");

await page.goto("/");
await page.getByTestId("leftnav").getByRole("link", { name: "接口报告" }).click();
await page.getByTestId("report-list-table").getByText("成功").first().waitFor({ timeout: 15000 });
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(root, "portal/assets/shots/reports.png") });
console.log("[shot] reports.png ✓");
await browser.close();
// 故意不清理：PG 留给后续补拍/排障，由人工统一收
process.exit(0);
