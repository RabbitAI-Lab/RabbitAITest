#!/usr/bin/env node
/**
 * 独立 embedded-postgres 启动器（开发/脚本用，端口 5433）：
 * PGDATA 已初始化（有 PG_VERSION）则跳过 initdb 直接 start；半初始化残留则清空重建。
 * 用法：node scripts/pg-dev.mjs   （进程常驻，Ctrl-C 退出）
 */
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.pgdata');
const port = 5433;

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

const fresh = !existsSync(path.join(dataDir, 'PG_VERSION'));
if (fresh) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase('rabbit');
} catch {
  // 已存在
}
console.log(`[pg-dev] ready :${port} fresh=${fresh} DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${port}/rabbit`);
setInterval(() => {}, 60000);
