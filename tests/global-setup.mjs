/**
 * E2E 环境（INFRA-002 测试隔离）：
 * - CI：直接使用注入的 DATABASE_URL / REDIS_URL（GitHub services）
 * - 本地：独立 embedded-postgres（:5434，.pgdata-e2e 每次清空）+ Docker Redis（:6381，rabbit-e2e-redis）
 * - 启动 engine worker 与 mock，供调试执行链路使用；web 由 playwright webServer 拉起（:3100）
 * 产物经 globalThis.__e2eEnv 传给 teardown。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function log(m) {
  console.log(`\x1b[36m[e2e-setup]\x1b[0m ${m}`);
}

function waitPort(port, host = "127.0.0.1", timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = net.connect(port, host);
      s.once("connect", () => {
        s.destroy();
        resolve();
      });
      s.once("error", () => {
        s.destroy();
        if (Date.now() > deadline) reject(new Error(`port ${port} timeout`));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

async function startEmbeddedPostgres() {
  const dataDir = path.join(root, ".pgdata-e2e");
  rmSync(dataDir, { recursive: true, force: true });
  const port = 5434;
  const mod = await import("embedded-postgres");
  const EmbeddedPostgres = mod.default ?? mod.EmbeddedPostgres ?? mod;
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("rabbit_e2e");
  process.env.E2E_DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/rabbit_e2e`;
  log(`embedded-postgres(e2e) :${port} 全新数据目录`);
  return pg;
}

async function ensureRedis() {
  const port = 6381;
  try {
    await waitPort(port, "127.0.0.1", 500);
  } catch {
    spawnSync("docker", ["start", "rabbit-e2e-redis"], { stdio: "ignore" });
    spawnSync(
      "docker",
      ["run", "-d", "--name", "rabbit-e2e-redis", "-p", "6381:6379", "redis:7-alpine"],
      { stdio: "ignore" },
    );
    await waitPort(port, "127.0.0.1", 20000);
  }
  process.env.E2E_REDIS_URL = `redis://127.0.0.1:${port}`;
  // 1000 而非 200：pg-e2e 常驻库跨轮累积用户（注册通道不查上限，仅管理端 createUser 查），
  // 2026-09-27 累积 268>200 致 SYS-004-01 建用户 400 USER_TOO_MANY；产品默认 30 不变
  process.env.RABBIT_USER_LIMIT = '1000';
  log(`redis(e2e) :${port}`);
}

export default async function globalSetup() {
  const useExternal = Boolean(process.env.E2E_DATABASE_URL && process.env.E2E_REDIS_URL);
  let pg = null;
  if (!useExternal) {
    pg = await startEmbeddedPostgres();
    await ensureRedis();
  }
  const env = {
    ...process.env,
    DATABASE_URL: process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL,
    REDIS_URL: process.env.E2E_REDIS_URL ?? process.env.REDIS_URL,
    WEB_URL: "http://localhost:3100",
    SESSION_SECRET: "e2e-session-secret-32chars-ok!!!!!",
    INTERNAL_TOKEN: "e2e-internal-token",
    // e2e mock 独占 :4001（web 经 MOCK_PUBLIC_URL 展示/下发 4001 地址）——与开发栈 :4000 并存互不抢占
    MOCK_PORT: "4001",
    // S7 AI：种子内置一台指向 e2e mock(:4001) 的模型（AI-002~005 spec 直接可用；环回豁免经 webServer env 注入；
    // baseUrl 含 /ai 前缀——mock 路由 /ai/chat/completions）
    RABBIT_SEED_AI_MOCK_BASE: "http://127.0.0.1:4001/ai",
    // S6：集成凭据加密密钥（值=测试常量非真实凭据）+ Swagger 同步目标为本地 mock → 放开私网出站
    RABBIT_INTEGRATION_SECRET: "e2e-integration-secret-32chars-ok!!",
    OUTBOUND_ALLOW_PRIVATE: "1",
    // S6：mock 平台测试凭据（非真实凭据——mock 校验非空制）
    E2E_PLATFORM_USER: process.env.E2E_PLATFORM_USER ?? "platform-e2e-user",
    E2E_PLATFORM_PASS: process.env.E2E_PLATFORM_PASS ?? "platform-e2e-pass",
  };
  for (const k of ["DATABASE_URL", "REDIS_URL", "WEB_URL", "SESSION_SECRET", "INTERNAL_TOKEN", "RABBIT_INTEGRATION_SECRET", "OUTBOUND_ALLOW_PRIVATE", "MOCK_PORT", "E2E_PLATFORM_USER", "E2E_PLATFORM_PASS"]) {
    if (env[k]) process.env[k] = env[k];
  }
  // webServer（独立进程）经 env 文件获取上述变量
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    path.join(root, "tests", ".e2e.env"),
    `DATABASE_URL=${env.DATABASE_URL}\nREDIS_URL=${env.REDIS_URL}\nWEB_URL=${env.WEB_URL}\nSESSION_SECRET=${env.SESSION_SECRET}\nINTERNAL_TOKEN=${env.INTERNAL_TOKEN}\nPORT=3100\nSESSION_COOKIE_SECURE=false\nRABBIT_INTEGRATION_SECRET=${env.RABBIT_INTEGRATION_SECRET}\nOUTBOUND_ALLOW_PRIVATE=${env.OUTBOUND_ALLOW_PRIVATE}\nMOCK_PORT=${env.MOCK_PORT}\nLOG_LEVEL=warn\n`,
  );
  log("migrate deploy + seed …");
  const migrate = spawnSync("pnpm", ["--filter", "@rabbit/db", "migrate-deploy"], {
    stdio: "inherit",
    env,
    cwd: root,
  });
  if (migrate.status !== 0) throw new Error("e2e 迁移失败");
  spawnSync("pnpm", ["--filter", "@rabbit/db", "seed"], { stdio: "inherit", env, cwd: root });

  const procs = [];
  const start = (name, pkg) => {
    const p = spawn("pnpm", ["--filter", pkg, "start"], { cwd: root, env, stdio: "inherit" });
    procs.push({ name, p });
  };
  // :4001 若被上一轮残留占用先释放（e2e mock 专用端口，与开发栈 :4000 隔离）
  try {
    const holders = spawnSync("lsof", ["-ti", ":4001"], { encoding: "utf8" });
    const pids = (holders.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), "SIGKILL");
        log(`释放 :4001（杀残留进程 ${pid}）`);
      } catch {
        /* 已退出 */
      }
    }
  } catch {
    /* lsof 不可用时跳过 */
  }
  start("engine", "engine");
  start("mock", "mock");
  await waitPort(4001, "127.0.0.1", 20000).catch(() => log("mock 端口未就绪（继续，用例将失败）"));
  await new Promise((r) => setTimeout(r, 2000));

  globalThis.__e2eEnv = { procs, pg };
  log("engine + mock 已启动，web 交给 playwright webServer");
}
