#!/usr/bin/env node
/**
 * 本地零依赖开发入口（INFRA-002 §4）：
 * 1) embedded-postgres（.pgdata，端口 5433；DATABASE_URL 已设则跳过）
 * 2) Redis：已有 6379 → 复用；否则 docker 拉起 rabbit-dev-redis
 * 3) prisma migrate deploy + seed
 * 4) 并发启动 web / engine / mock / plugin-runner，Ctrl-C 统一回收
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
let shuttingDown = false;

function log(msg) { console.log(`\x1b[36m[dev]\x1b[0m ${msg}`); }

function waitPort(port, host = '127.0.0.1', timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = net.connect(port, host);
      s.once('connect', () => { s.destroy(); resolve(); });
      s.once('error', () => {
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
  const dataDir = path.join(root, '.pgdata');
  const port = 5433;
  // 仅复用有效 PGDATA（有 PG_VERSION）；半初始化残留目录清空重建，避免 initdb 报「目录已存在」
  if (existsSync(dataDir) && !existsSync(path.join(dataDir, 'PG_VERSION'))) {
    rmSync(dataDir, { recursive: true, force: true });
  }
  const mod = await import('embedded-postgres');
  const EmbeddedPostgres = mod.default ?? mod.EmbeddedPostgres ?? mod;
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('rabbit');
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/rabbit`;
  log(`embedded-postgres 就绪 :${port}（${dataDir}）`);
  globalThis.__pg = pg; // teardown 用
}

async function ensureRedis() {
  if (process.env.REDIS_URL) {
    log(`REDIS_URL 已设置：${process.env.REDIS_URL}`);
    return;
  }
  try {
    await waitPort(6379, '127.0.0.1', 500);
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    log('复用本机 Redis :6379');
    return;
  } catch { /* 无本机 redis */ }
  const docker = spawnSync('docker', ['start', 'rabbit-dev-redis'], { stdio: 'ignore' });
  if (docker.status !== 0) {
    const run = spawnSync('docker', ['run', '-d', '--name', 'rabbit-dev-redis', '-p', '6379:6379', 'redis:7-alpine'], { stdio: 'ignore' });
    if (run.status !== 0) {
      throw new Error('无可用 Redis：请启动本机 redis 或 Docker（docker run -d -p 6379:6379 redis:7-alpine）');
    }
  }
  await waitPort(6379, '127.0.0.1', 20000);
  process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  log('Docker Redis 就绪 :6379');
}

function run(name, cmd, args, opts = {}) {
  const p = spawn(cmd, args, {
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: 'inherit',
  });
  p.on('exit', (code) => {
    if (!shuttingDown) console.log(`\x1b[33m[${name}] exited ${code}\x1b[0m`);
  });
  children.push({ name, p });
  return p;
}

async function main() {
  await startEmbeddedPostgres();
  await ensureRedis();
  log('prisma migrate deploy + seed …');
  const migrate = spawnSync('pnpm', ['--filter', '@rabbit/db', 'migrate-deploy'], { stdio: 'inherit', env: process.env, cwd: root });
  if (migrate.status !== 0) throw new Error('迁移失败');
  const seed = spawnSync('pnpm', ['--filter', '@rabbit/db', 'seed'], { stdio: 'inherit', env: process.env, cwd: root });
  if (seed.status !== 0) throw new Error('种子失败');

  run('web', 'pnpm', ['--filter', 'web', 'dev'], { env: {} });
  run('engine', 'pnpm', ['--filter', 'engine', 'dev'], { env: {} });
  run('mock', 'pnpm', ['--filter', 'mock', 'dev'], { env: {} });
  run('plugin-runner', 'pnpm', ['--filter', 'plugin-runner', 'dev'], { env: {} });
  log('全部服务已启动：web http://localhost:3000 · Ctrl-C 统一退出');
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[dev] 回收进程…');
  for (const { p } of children) {
    try { p.kill('SIGINT'); } catch { /* noop */ }
  }
  const pg = globalThis.__pg;
  if (pg) pg.stop().finally(() => process.exit(0));
  else process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
