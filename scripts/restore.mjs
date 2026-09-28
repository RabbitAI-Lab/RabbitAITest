#!/usr/bin/env node
/**
 * 数据恢复（INFRA-004；backup.mjs 的逆操作）：
 *   解包 → manifest 校验（PG 大版本前缀一致）→ TRUNCATE 全表（CASCADE）→ 拓扑序回放（外键依赖）→ 附件目录回放。
 *   不自动 migrate（要求目标库 schema 已就位：先 `pnpm --filter @rabbit/db migrate-deploy`）；不自动 seed（防覆盖恢复数据）。
 * 用法：node scripts/restore.mjs <backup.tar.gz> [--db DATABASE_URL] [--yes]
 */
import { Client } from "pg";
import { readFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const DATABASE_URL = flag("db", process.env.DATABASE_URL);
if (!file || !DATABASE_URL) {
  console.error("用法：node scripts/restore.mjs <backup.tar.gz> --db DATABASE_URL [--yes]");
  process.exit(1);
}
if (!args.includes("--yes")) {
  console.error("恢复将 TRUNCATE 目标库全部表并回放备份数据。确认请加 --yes");
  process.exit(1);
}

const tmp = path.join(ROOT, `.restore-tmp-${randomUUID().slice(0, 8)}`);
mkdirSync(tmp, { recursive: true });
execFileSync("tar", ["-xzf", path.resolve(file), "-C", tmp], { stdio: "inherit" });

const manifest = JSON.parse(readFileSync(path.join(tmp, "manifest.json"), "utf8"));
if (manifest.kind !== "rabbit-backup") {
  console.error("manifest.kind 非法（不是 rabbit-backup）");
  rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}
const data = JSON.parse(readFileSync(path.join(tmp, "tables.json"), "utf8"));

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();
const { server_version: targetVersion } = (await client.query(`SHOW server_version`)).rows[0];
if (String(targetVersion).split(".")[0] !== String(manifest.pgVersion).split(".")[0]) {
  console.error(`PG 大版本不一致（备份 ${manifest.pgVersion} vs 目标 ${targetVersion}），拒绝恢复`);
  await client.end();
  rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}

// 拓扑排序：备份中的表按外键依赖（目标库 schema 已存在）
const tables = Object.keys(data);
const fkRows = (
  await client.query(
    `SELECT tc.table_name AS src, ccu.table_name AS dst
     FROM information_schema.table_constraints tc
     JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
     WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'`,
  )
).rows;
const edges = fkRows.filter(
  (e) => tables.includes(e.src) && tables.includes(e.dst) && e.src !== e.dst,
);
const sorted = [];
const visiting = new Set();
const visited = new Set();
function visit(t, chain = new Set()) {
  if (visited.has(t)) return;
  if (chain.has(t)) return; // 自环/环（schema 层已禁，防御）
  chain.add(t);
  for (const e of edges.filter((e) => e.src === t)) visit(e.dst, chain);
  chain.delete(t);
  visited.add(t);
  sorted.push(t);
}
for (const t of tables) visit(t, visiting);
visiting.clear();

// 列类型（jsonb/json 列需回放为字符串）
const jsonCols = new Map();
for (const t of tables) {
  const cols = (
    await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND data_type IN ('jsonb','json')`,
      [t],
    )
  ).rows.map((r) => r.column_name);
  if (cols.length) jsonCols.set(t, new Set(cols));
}

// 清场 + 按拓扑序回放
await client
  .query(
    `TRUNCATE ${sorted.map((t) => `"${t}"`).join(", ")}, _prisma_migrations RESTART IDENTITY CASCADE`,
  )
  .catch(async () => {
    // _prisma_migrations 可能不在备份集（无碍——按张兜底）
    await client.query(
      `TRUNCATE ${sorted.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
  });

let inserted = 0;
for (const t of sorted) {
  const rows = data[t] ?? [];
  if (rows.length === 0) continue;
  const cols = Object.keys(rows[0]);
  const jc = jsonCols.get(t);
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const values = [];
    const params = [];
    batch.forEach((row, bi) => {
      const holders = cols.map((c, ci) => {
        const v = jc?.has(c) && row[c] != null ? JSON.stringify(row[c]) : row[c];
        params.push(v);
        return `$${bi * cols.length + ci + 1}`;
      });
      values.push(`(${holders.join(",")})`);
    });
    await client.query(
      `INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES ${values.join(",")}`,
      params,
    );
    inserted += batch.length;
  }
}
await client.end();

// 附件/文件目录回放
for (const name of ["attachments", "files"]) {
  const src = path.join(tmp, name);
  if (existsSync(src)) {
    cpSync(src, path.join(ROOT, "data", name), { recursive: true });
    console.log(`目录已回放：data/${name}`);
  }
}
rmSync(tmp, { recursive: true, force: true });

console.log(`恢复完成：表 ${sorted.length} 张 / 行 ${inserted}（备份含 ${manifest.rowCount} 行）`);
console.log("提醒：① 未自动 seed（防覆盖）；② 重启 web/engine 使缓存失效。");
