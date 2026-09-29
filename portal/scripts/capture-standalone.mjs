/**
 * 门户截图独立补拍（隔离栈）：不与 e2e 全家桶/其他 worktree 共享端口。
 * 栈：PG :5455（.pgdata-portal）+ redis :6399（docker rabbit-portal-redis）+ mock :4099 + engine + web :3199
 * 用法：node portal/scripts/capture-standalone.mjs [shotsDir]
 * 前置：仓库根已 pnpm install、apps/web 已 build、docker 可用。
 */
import { spawn, spawnSync, execSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shotsDir = path.resolve(process.argv[2] ?? path.join(root, "portal/assets/shots"));
mkdirSync(shotsDir, { recursive: true });

const PORTS = { pg: 5455, redis: 6399, mock: 4099, web: 3199 };
const DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${PORTS.pg}/rabbit_portal`;
const REDIS_URL = `redis://127.0.0.1:${PORTS.redis}`;
const WEB_URL = `http://127.0.0.1:${PORTS.web}`;
const TOKEN = "portal-internal-token-32chars-ok!!!";
const MOCK_URL = `http://127.0.0.1:${PORTS.mock}/hello`;

const log = (m) => console.log(`\x1b[36m[capture]\x1b[0m ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPort(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const okConn = await new Promise((resolve) => {
      const s = net.connect(port, "127.0.0.1");
      s.once("connect", () => { s.destroy(); resolve(true); });
      s.once("error", () => { s.destroy(); resolve(false); });
    });
    if (okConn) return;
    if (Date.now() > deadline) throw new Error(`port ${port} timeout`);
    await sleep(300);
  }
}

async function waitHttp(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`${url} timeout`);
    await sleep(500);
  }
}

const procs = [];
function start(name, command, args, env) {
  const p = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "inherit", "inherit"] });
  procs.push(p);
  p.on("exit", (c) => log(`${name} 退出 code=${c}`));
  return p;
}

async function main() {
  // 1) redis（独占容器名，误存则复用）
  try { await waitPort(PORTS.redis, 500); log("redis :6399 已在"); }
  catch {
    spawnSync("docker", ["rm", "-f", "rabbit-portal-redis"], { stdio: "ignore" });
    spawnSync("docker", ["run", "-d", "--name", "rabbit-portal-redis", "-p", `${PORTS.redis}:6379`, "redis:7-alpine"], { stdio: "ignore" });
    await waitPort(PORTS.redis, 20000);
    log("redis :6399 已起");
  }

  // 2) embedded-postgres（独立数据目录 .pgdata-portal，幂等）
  const mod = await import("embedded-postgres");
  const EP = mod.default ?? mod.EmbeddedPostgres ?? mod;
  const pg = new EP({
    databaseDir: path.join(root, ".pgdata-portal"),
    user: "postgres", password: "postgres", port: PORTS.pg, persistent: true,
  });
  if (!existsSync(path.join(root, ".pgdata-portal/PG_VERSION"))) await pg.initialise();
  await pg.start();
  try { await pg.createDatabase("rabbit_portal"); } catch { /* 已存在 */ }
  log("postgres :5455 已起");

  // 3) 迁移 + 种子
  const dbEnv = { ...process.env, DATABASE_URL };
  for (const [name, args] of [["migrate", ["--filter", "@rabbit/db", "migrate-deploy"]], ["seed", ["--filter", "@rabbit/db", "seed"]]]) {
    const r = spawnSync("pnpm", args, { cwd: root, env: dbEnv, stdio: "inherit" });
    if (r.status !== 0) throw new Error(`${name} 失败`);
  }
  log("迁移与种子完成");

  // 4) mock + engine + web
  const svcEnv = {
    DATABASE_URL, REDIS_URL, WEB_URL,
    SESSION_SECRET: "portal-session-secret-32chars-ok!!",
    INTERNAL_TOKEN: TOKEN,
    SESSION_COOKIE_SECURE: "false",
    MOCK_PORT: String(PORTS.mock),
    MOCK_PUBLIC_URL: `http://127.0.0.1:${PORTS.mock}`,
    OUTBOUND_ALLOW_PRIVATE: "1",
    AI_ALLOW_PRIVATE_BASEURL: "1",
    RABBIT_INTEGRATION_SECRET: "portal-integration-secret-32chars!",
    RABBIT_USER_LIMIT: "1000",
    LOG_LEVEL: "warn",
  };
  start("mock", "pnpm", ["--filter", "mock", "start"], svcEnv);
  await waitPort(PORTS.mock, 20000);
  start("engine", "pnpm", ["--filter", "engine", "start"], svcEnv);
  start("web", "pnpm", ["--filter", "web", "start"], { ...svcEnv, PORT: String(PORTS.web) });
  await waitHttp(`${WEB_URL}/api/v1/system/health`, 120000);
  log("web :3199 已起");
  await sleep(2000); // engine 注册/心跳一拍

  // 5) 截图（Playwright 独立驱动）
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: WEB_URL });
  const page = await ctx.newPage();

  // 注册（API）→ 会话 cookie 注入
  const email = `portal-${Date.now()}@rabbit.test`;
  const reg = await ctx.request.post("/api/v1/auth/register", { data: { email, password: "rabbit-pass-123" } });
  if (reg.status() !== 201) throw new Error(`注册失败 ${reg.status()}`);
  const { data: regData } = await reg.json();
  const ras = (reg.headers()["set-cookie"] ?? "").split("ras=")[1]?.split(";")[0];
  if (ras) await ctx.addCookies([{ name: "ras", value: ras, url: WEB_URL }]);
  const pid = regData.projectId;
  log(`已注册用户并拿到项目 ${pid}`);

  // 造一个调试任务并等引擎执行完
  const task = await ctx.request.post(`/api/v1/projects/${pid}/exec-tasks`, {
    data: {
      type: "api_debug",
      request: { method: "GET", url: MOCK_URL, headers: [], query: [], body: { kind: "none" }, auth: { kind: "none" }, timeoutMs: 10000, followRedirects: false, skipPre: false, skipPost: false },
      asserts: [{ kind: "status_code", path: "", op: "eq", expected: "200" }],
      pre: [], post: [], extracts: [],
    },
  });
  if (task.status() !== 201) throw new Error(`建任务失败 ${task.status()}`);

  // 任务中心：等 SUCCESS
  await page.goto("/");
  await page.getByTestId("leftnav").getByRole("link", { name: "任务中心" }).click();
  await page.getByTestId("task-list-table").getByText("SUCCESS").first().waitFor({ timeout: 45000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(shotsDir, "tasks.png") });
  log("tasks.png ✓");

  // 接口报告：等 SUCCESS 行
  await page.getByTestId("leftnav").getByRole("link", { name: "接口报告" }).click();
  await page.getByTestId("report-list-table").getByText("SUCCESS").first().waitFor({ timeout: 45000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(shotsDir, "reports.png") });
  log("reports.png ✓");

  await browser.close();
}

main()
  .then(() => { log("完成"); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => {
    for (const p of procs) p.kill("SIGTERM");
    // embedded-postgres 子进程不随 node 退出回收，按端口清
    try {
      const out = execSync("lsof -ti :5455", { encoding: "utf8" }).trim();
      if (out) for (const pid of out.split("\n")) process.kill(Number(pid), "SIGTERM");
    } catch { /* 无残留 */ }
  });
