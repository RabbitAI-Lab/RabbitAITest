#!/usr/bin/env node
/** 临时 embedded-postgres 包装器：起库 → 执行子命令 → 停库。用法：node scripts/with-pg.mjs <port> <cmd...> */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] ?? 5435);
const cmd = process.argv.slice(3);
if (cmd.length === 0) {
  console.error('用法: node scripts/with-pg.mjs <port> <cmd...>');
  process.exit(2);
}
const dataDir = path.join(root, `.pgdata-tmp-${port}`);
rmSync(dataDir, { recursive: true, force: true });
const mod = await import('embedded-postgres');
const EmbeddedPostgres = mod.default ?? mod.EmbeddedPostgres ?? mod;
const pg = new EmbeddedPostgres({
  databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: false,
});
await pg.initialise();
await pg.start();
await pg.createDatabase('rabbit');
const env = {
  ...process.env,
  DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${port}/rabbit`,
};
console.log(`[with-pg] :${port} ready`);
const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', env, cwd: root });
await pg.stop();
rmSync(dataDir, { recursive: true, force: true });
process.exit(r.status ?? 1);
