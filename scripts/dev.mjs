#!/usr/bin/env node
/**
 * 本地零依赖开发入口（INFRA-002 §4；INFRA-005 slot 化）：
 * 1) embedded-postgres（.pgdata，端口 = 5440+slot；DATABASE_URL 已设则跳过）
 * 2) Redis：已有 6379 → 复用（逻辑库号 = slot）；否则 docker 拉起 rabbit-dev-redis
 * 3) prisma migrate deploy + seed
 * 4) 并发启动 web / engine / mock / plugin-runner，Ctrl-C 统一回收
 * 端口/Redis/路径一律出自 scripts/rabbit-env.mjs（worktree 槽位单一事实源，禁止硬编码）
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rabbitEnv } from "./rabbit-env.mjs";

const ENV = rabbitEnv();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = [];
let shuttingDown = false;

function log(msg) {
  console.log(`\x1b[36m[dev]\x1b[0m ${msg}`);
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
  if (process.env.DATABASE_URL) {
    log(`DATABASE_URL 已设置，跳过 embedded-postgres：${process.env.DATABASE_URL}`);
    return;
  }
  const dataDir = path.join(root, ENV.dev.pgDataDir);
  const port = ENV.dev.pgPort;
  // 仅复用有效 PGDATA（有 PG_VERSION）；半初始化残留目录清空重建，避免 initdb 报「目录已存在」
  if (existsSync(dataDir) && !existsSync(path.join(dataDir, "PG_VERSION"))) {
    rmSync(dataDir, { recursive: true, force: true });
  }
  const mod = await import("embedded-postgres");
  const EmbeddedPostgres = mod.default ?? mod.EmbeddedPostgres ?? mod;
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
  });
  // 重启场景：已有 PG_VERSION 跳过 initdb（原无条件 initialise 在持久目录上必失败）；
  // kill -9 残留的 postmaster.pid 一并清理，避免 start 报锁文件
  if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
    await pg.initialise();
  } else {
    rmSync(path.join(dataDir, "postmaster.pid"), { force: true });
  }
  await pg.start();
  try {
    await pg.createDatabase(ENV.dev.database);
  } catch {
    // 已存在（持久目录重启）
  }
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/${ENV.dev.database}`;
  log(`embedded-postgres 就绪 :${port}（${dataDir}）`);
  globalThis.__pg = pg; // teardown 用
}

async function ensureRedis() {
  if (process.env.REDIS_URL) {
    log(`REDIS_URL 已设置：${process.env.REDIS_URL}`);
    return;
  }
  // 实例共享（6379），键空间按逻辑库号 = slot 隔离——多 worktree 并行不串台（INFRA-005）
  try {
    await waitPort(ENV.dev.redisPort, "127.0.0.1", 500);
    process.env.REDIS_URL = ENV.dev.redisUrl;
    log(`复用本机 Redis :${ENV.dev.redisPort}（db=${ENV.slot}）`);
    return;
  } catch {
    /* 无本机 redis */
  }
  const docker = spawnSync("docker", ["start", "rabbit-dev-redis"], { stdio: "ignore" });
  if (docker.status !== 0) {
    const run = spawnSync(
      "docker",
      ["run", "-d", "--name", "rabbit-dev-redis", "-p", "6379:6379", "redis:7-alpine"],
      { stdio: "ignore" },
    );
    if (run.status !== 0) {
      throw new Error(
        "无可用 Redis：请启动本机 redis 或 Docker（docker run -d -p 6379:6379 redis:7-alpine）",
      );
    }
  }
  await waitPort(ENV.dev.redisPort, "127.0.0.1", 20000);
  process.env.REDIS_URL = ENV.dev.redisUrl;
  log(`Docker Redis 就绪 :${ENV.dev.redisPort}（db=${ENV.slot}）`);
}

/** 槽位端口预检：被占即 fail fast 并指明归属（避免与并行 worktree 栈静默互抢） */
async function assertSlotPortsFree() {
  const claims = [
    [ENV.dev.webPort, "web"],
    [ENV.dev.mockPort, "mock"],
  ];
  for (const [port, name] of claims) {
    const busy = await new Promise((resolve) => {
      const s = net.connect(port, "127.0.0.1");
      s.once("connect", () => {
        s.destroy();
        resolve(true);
      });
      s.once("error", () => {
        s.destroy();
        resolve(false);
      });
    });
    if (busy) {
      throw new Error(
        `slot ${ENV.slot} 的 ${name} 端口 :${port} 已被占用（可能是其他栈残留或并行 worktree）。` +
          `排查：lsof -nP -i :${port}；换槽：RABBIT_SLOT=0-9 或改用对应 RabbitAITest-s{N} 目录。`,
      );
    }
  }
}

function run(name, cmd, args, opts = {}) {
  const p = spawn(cmd, args, {
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: "inherit",
  });
  p.on("exit", (code) => {
    if (!shuttingDown) console.log(`\x1b[33m[${name}] exited ${code}\x1b[0m`);
  });
  children.push({ name, p });
  return p;
}

async function main() {
  log(
    `worktree slot=${ENV.slot}（web :${ENV.dev.webPort} · mock :${ENV.dev.mockPort} · pg :${ENV.dev.pgPort}）`,
  );
  await assertSlotPortsFree();
  await startEmbeddedPostgres();
  await ensureRedis();
  log("prisma migrate deploy + seed …");
  const migrate = spawnSync("pnpm", ["--filter", "@rabbit/db", "migrate-deploy"], {
    stdio: "inherit",
    env: process.env,
    cwd: root,
  });
  if (migrate.status !== 0) throw new Error("迁移失败");
  const seed = spawnSync("pnpm", ["--filter", "@rabbit/db", "seed"], {
    stdio: "inherit",
    env: process.env,
    cwd: root,
  });
  if (seed.status !== 0) throw new Error("种子失败");

  // web 端口经 PORT 注入（apps/web dev 脚本未写死 -p）；engine 回调 web 走 WEB_INTERNAL_URL/WEB_URL；
  // PLUGIN_RUNNER_PORT 随槽位（S-future PLUG-003 内嵌 runner 默认 4010 会跨 worktree 互抢）
  const stackEnv = {
    PORT: String(ENV.dev.webPort),
    WEB_URL: ENV.dev.webUrl,
    WEB_INTERNAL_URL: `http://127.0.0.1:${ENV.dev.webPort}`,
    MOCK_PORT: String(ENV.dev.mockPort),
    MOCK_PUBLIC_URL: ENV.dev.mockUrl,
    PLUGIN_RUNNER_PORT: String(ENV.dev.runnerPort),
  };
  run("web", "pnpm", ["--filter", "web", "dev"], { env: stackEnv });
  run("engine", "pnpm", ["--filter", "engine", "dev"], { env: stackEnv });
  run("mock", "pnpm", ["--filter", "mock", "dev"], { env: stackEnv });
  run("plugin-runner", "pnpm", ["--filter", "plugin-runner", "dev"], { env: stackEnv });
  log(`全部服务已启动：web ${ENV.dev.webUrl} · Ctrl-C 统一退出`);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n[dev] 回收进程…");
  for (const { p } of children) {
    try {
      p.kill("SIGINT");
    } catch {
      /* noop */
    }
  }
  const pg = globalThis.__pg;
  if (pg) pg.stop().finally(() => process.exit(0));
  else process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
