#!/usr/bin/env node
/**
 * 性能基准种子（QA-001 §4）：专用 perf-baseline 项目 + 10 模块 + 万级用例（quick 口径 1k）。
 * 幂等：项目已存在且用例数达标即跳过（--reset 清理重建）。
 * 用法：node scripts/perf-seed.mjs [--scope quick|full] [--reset] [--db DATABASE_URL]
 */
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const scope = args.includes("--scope") ? args[args.indexOf("--scope") + 1] : "full";
const CASE_COUNT = scope === "quick" ? 1000 : 10_000;
const MODULE_COUNT = 10;
const DATABASE_URL = args.includes("--db")
  ? args[args.indexOf("--db") + 1]
  : process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("需要 DATABASE_URL");
  process.exit(1);
}

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

// 默认组织 + 管理员（seed 口径）
const org = (await client.query(`SELECT id FROM "Organization" LIMIT 1`)).rows[0];
const admin = (await client.query(`SELECT id FROM "User" LIMIT 1`)).rows[0];
if (!org || !admin) {
  console.error("缺默认组织/用户——先 pnpm --filter @rabbit/db seed");
  process.exit(1);
}

let proj = (
  await client.query(
    `SELECT id FROM projects WHERE name='性能基线专用' AND deleted_at IS NULL LIMIT 1`,
  )
).rows[0];
if (args.includes("--reset") && proj) {
  await client.query(`DELETE FROM functional_cases WHERE project_id=$1`, [proj.id]);
  await client.query(`DELETE FROM module_nodes WHERE project_id=$1 AND is_default=false`, [
    proj.id,
  ]);
  await client.query(`DELETE FROM project_members WHERE project_id=$1`, [proj.id]);
  await client.query(`DELETE FROM projects WHERE id=$1`, [proj.id]);
  proj = undefined;
}
if (!proj) {
  const id = randomUUID();
  const numNext = (
    await client.query(`SELECT coalesce(max(num),0)+1 AS n FROM projects WHERE org_id=$1`, [org.id])
  ).rows[0].n;
  await client.query(
    `INSERT INTO projects (id, org_id, num, name, description, created_at, updated_at) VALUES ($1,$2,$3,'性能基线专用','QA-001 perf-seed 自动创建（可安全删除）',now(),now())`,
    [id, org.id, numNext],
  );
  await client.query(
    `INSERT INTO project_members (id, project_id, user_id, role) VALUES ($1,$2,$3,'ADMIN')`,
    [randomUUID(), id, admin.id],
  );
  proj = { id, num: "PERF-BASELINE" };
  console.log(`已创建项目 性能基线专用（${id.slice(0, 8)}）`);
}

const existing = (
  await client.query(`SELECT count(*)::int AS n FROM functional_cases WHERE project_id=$1`, [
    proj.id,
  ])
).rows[0].n;
if (existing >= CASE_COUNT) {
  console.log(`种子已就绪：${existing} 用例 ≥ ${CASE_COUNT}（--reset 重建）`);
  await client.end();
  process.exit(0);
}

// 模块（含默认根，共 MODULE_COUNT 个具名模块）
const modules = (
  await client.query(`SELECT id FROM module_nodes WHERE project_id=$1 AND scene='case'`, [proj.id])
).rows;
let moduleIds = modules.map((m) => m.id);
if (moduleIds.length < MODULE_COUNT) {
  for (let i = moduleIds.length; i < MODULE_COUNT; i++) {
    const mid = randomUUID();
    await client.query(
      `INSERT INTO module_nodes (id, project_id, scene, name, "order", created_at, updated_at) VALUES ($1,$2,'case',$3,$4,now(),now())`,
      [mid, proj.id, `性能模块-${String(i + 1).padStart(2, "0")}`, i],
    );
    moduleIds.push(mid);
  }
}

// 用例编号起点（避开既有）
const numBase = (
  await client.query(
    `SELECT coalesce(max(num),0)::int AS m FROM functional_cases WHERE project_id=$1`,
    [proj.id],
  )
).rows[0].m;

const BATCH = 500;
for (let off = existing; off < CASE_COUNT; off += BATCH) {
  const end = Math.min(off + BATCH, CASE_COUNT);
  const values = [];
  const params = [];
  for (let i = off; i < end; i++) {
    const p = values.length * 13; // 每行 13 参，占位连续编号
    values.push(
      `($${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6},$${p + 7},$${p + 8},$${p + 9},$${p + 10},$${p + 11},$${p + 12},$${p + 13})`,
    );
    params.push(
      randomUUID(),
      proj.id,
      moduleIds[i % moduleIds.length],
      numBase + i + 1,
      `性能用例-${String(i + 1).padStart(5, "0")} ${["登录", "下单", "退款", "搜索", "导出"][i % 5]}流程验证`,
      `预置数据#${i}`,
      JSON.stringify([
        { desc: `步骤一（${i}）`, expect: "响应 200" },
        { desc: "步骤二", expect: "落库正确" },
      ]),
      ["P0", "P1", "P2", "P3"][i % 4],
      ["PREPARING", "UNDERWAY", "COMPLETED"][i % 3],
      JSON.stringify(["perf", `mod-${i % MODULE_COUNT}`]),
      admin.id,
      new Date().toISOString(),
      new Date().toISOString(),
    );
  }
  await client.query(
    `INSERT INTO functional_cases (id, project_id, module_id, num, name, precondition, steps, level, status, tags, created_by, created_at, updated_at)
     VALUES ${values.join(",")}`,
    params,
  );
  process.stdout.write(`  用例 ${end}/${CASE_COUNT}\n`);
}

console.log(`种子完成：项目 性能基线专用 / 用例 ${CASE_COUNT - existing} 新增（共 ${CASE_COUNT}）`);
await client.end();
