#!/usr/bin/env node
/**
 * 数据备份（INFRA-004；勘误 1：pg_dump -Fc → SQL 逻辑导出）：
 *   embedded-postgres 发行包仅含 initdb/pg_ctl/postros 三个二进制（无 pg_dump/pg_restore），
 *   故备份=逐表 SELECT 全量行（JSON）+ 附件/文件目录 + manifest → 系统 tar 打包 .tar.gz。
 *   纯 node 依赖（pg 驱动），CI 可测 roundtrip（restore.mjs 单测）；物理 pg_dump 口径登记部署文档。
 * 用法：node scripts/backup.mjs [--out backups/] [--db DATABASE_URL]
 */
import { Client } from "pg";
import { mkdirSync, writeFileSync, cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const DATABASE_URL = flag("db", process.env.DATABASE_URL);
if (!DATABASE_URL) {
  console.error("需要 DATABASE_URL（--db 或环境变量）");
  process.exit(1);
}
const outDir = path.resolve(ROOT, flag("out", "backups"));

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

const tables = (
  await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`,
  )
).rows.map((r) => r.table_name);

const data = {};
for (const t of tables) {
  const res = await client.query(`SELECT * FROM "${t}"`);
  data[t] = res.rows;
}

const { server_version: pgVersion } = (await client.query(`SHOW server_version`)).rows[0];
await client.end();

const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 17);
const tmp = path.join(ROOT, `.backup-tmp-${randomUUID().slice(0, 8)}`);
mkdirSync(tmp, { recursive: true });

const manifest = {
  kind: "rabbit-backup",
  version: 1,
  createdAt: new Date().toISOString(),
  pgVersion,
  tableCount: tables.length,
  rowCount: Object.values(data).reduce((a, rows) => a + rows.length, 0),
};
writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(path.join(tmp, "tables.json"), JSON.stringify(data));

// 附件/文件目录（存在才纳入）
for (const [dir, name] of [
  [path.join(ROOT, "data", "attachments"), "attachments"],
  [path.join(ROOT, "data", "files"), "files"],
]) {
  if (existsSync(dir)) cpSync(dir, path.join(tmp, name), { recursive: true });
}

mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `rabbit-${stamp}.tar.gz`);
execFileSync("tar", ["-czf", outFile, "-C", tmp, "."], { stdio: "inherit" });
rmSync(tmp, { recursive: true, force: true });

console.log(`备份完成：${path.relative(ROOT, outFile)}`);
console.log(
  `  表 ${manifest.tableCount} 张 / 行 ${manifest.rowCount} / PG ${String(pgVersion).split(" ")[0]}\n` +
    `  恢复：node scripts/restore.mjs ${path.relative(ROOT, outFile)}\n` +
    `  建议：crontab 示例——0 2 * * * cd ${ROOT} && DATABASE_URL=... node scripts/backup.mjs`,
);
