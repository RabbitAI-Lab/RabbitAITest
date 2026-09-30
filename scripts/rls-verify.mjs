#!/usr/bin/env node
/**
 * INFRA-006 RLS 策略级验证（CI migrate-replay 步骤 / 本地：对已 migrate deploy 的库执行）。
 *
 * 断言（双租户夹具，SQL 层直验，不经应用；单 admin 连接 + SET LOCAL ROLE rabbit_tenant
 * 免角色口令——SET ROLE 后权限检查以 rabbit_tenant 身份进行，RLS 生效）：
 *   A. tenant + set_config(A) → 仅见 A 组织行（projects/functional_cases）
 *   B. tenant + set_config(A) → INSERT B 项目的用例 → 42501 拒绝（WITH CHECK）
 *   C. tenant 未设上下文 → 夹具行零可见（断路：宁可漏读不可串读）
 *   D. admin（owner）→ 两组织行全可见（豁免语义）
 *   E. 排除面：comments 无策略 → tenant 可写（多态表登记边界，行为同历史）
 * 清场：夹具全删（幂等可重跑）。
 */
import { randomUUID } from "node:crypto";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("rls-verify: 需要 DATABASE_URL");
  process.exit(1);
}

let failed = false;
const ok = (msg) => console.log(`PASS ${msg}`);
const fail = (msg) => {
  failed = true;
  console.error(`FAIL ${msg}`);
};

const admin = new pg.Client({ connectionString: url });
await admin.connect();

// —— 角色与授权引导（与 packages/db/src/tenant.ts 同口径；幂等）——
await admin.query(
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rabbit_tenant') THEN
      CREATE ROLE rabbit_tenant NOLOGIN;
    END IF;
  END $$;`,
);
await admin.query(
  `DO $$ BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO rabbit_tenant', current_database());
  END $$;`,
);
await admin.query("GRANT USAGE ON SCHEMA public TO rabbit_tenant");
await admin.query(
  "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rabbit_tenant",
);
await admin.query("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rabbit_tenant");
const pol = await admin.query(
  "SELECT count(*)::int AS n FROM pg_policy WHERE polname = 'tenant_isolation'",
);
if (pol.rows[0].n < 40) {
  fail(`pg_policy tenant_isolation 数量异常：${pol.rows[0].n}（期望 ≥40，迁移是否应用？）`);
}

// —— 夹具：双组织/双项目/各一模块一用例（绕过应用直插，列集最小化）——
const uid = randomUUID();
const orgA = randomUUID();
const orgB = randomUUID();
const projA = randomUUID();
const projB = randomUUID();
const modA = randomUUID();
const modB = randomUUID();
const caseA = randomUUID();
const caseB = randomUUID();

await admin.query(
  `INSERT INTO "User" (id, email, name, password_hash, updated_at) VALUES ($1, $2, 'rls-verify', 'x', now())`,
  [uid, `rlsv-${Date.now()}@rabbit.test`],
);
await admin.query(
  `INSERT INTO "Organization" (id, name, owner_id, updated_at) VALUES ($1, 'rlsv-org-a', $2, now()), ($3, 'rlsv-org-b', $2, now())`,
  [orgA, uid, orgB],
);
await admin.query(
  `INSERT INTO projects (id, org_id, name, num, updated_at) VALUES ($1, $2, 'rlsv-pa', 1, now()), ($3, $4, 'rlsv-pb', 1, now())`,
  [projA, orgA, projB, orgB],
);
await admin.query(
  `INSERT INTO module_nodes (id, project_id, scene, name, is_default, updated_at) VALUES ($1, $2, 'case', 'rlsv-mod', true, now()), ($3, $4, 'case', 'rlsv-mod', true, now())`,
  [modA, projA, modB, projB],
);
const caseCols = `(id, project_id, module_id, num, name, precondition, created_by, updated_at)`;
await admin.query(
  `INSERT INTO functional_cases ${caseCols} VALUES ($1, $2, $3, 1, 'rlsv-ca', '', $4, now()), ($5, $6, $7, 1, 'rlsv-cb', '', $4, now())`,
  [caseA, projA, modA, uid, caseB, projB, modB],
);

const inFix = (table) => `SELECT * FROM ${table} WHERE id = ANY($1)`;

try {
  // A. tenant + ctx(A)：仅见 A 行
  await admin.query("BEGIN");
  await admin.query("SET LOCAL ROLE rabbit_tenant");
  await admin.query("SELECT set_config('app.tenant_id', $1, true)", [orgA]);
  const aCases = await admin.query(inFix("functional_cases"), [[caseA, caseB]]);
  const aProjs = await admin.query(inFix("projects"), [[projA, projB]]);
  aCases.rowCount === 1 && aCases.rows[0].id === caseA
    ? ok("A tenant+ctxA 仅见 A 组织用例")
    : fail(`A 期望仅 ${caseA}，实际 ${JSON.stringify(aCases.rows)}`);
  aProjs.rowCount === 1 && aProjs.rows[0].id === projA
    ? ok("A tenant+ctxA 仅见 A 组织项目")
    : fail(`A 项目断言失败 rowCount=${aProjs.rowCount}`);
  await admin.query("ROLLBACK");

  // B. tenant + ctx(A)：写 B 项目 → 42501
  let bCode = "";
  try {
    await admin.query("BEGIN");
    await admin.query("SET LOCAL ROLE rabbit_tenant");
    await admin.query("SELECT set_config('app.tenant_id', $1, true)", [orgA]);
    await admin.query(
      `INSERT INTO functional_cases ${caseCols} VALUES ($1, $2, $3, 1, 'rlsv-bad', '', $4, now())`,
      [randomUUID(), projB, modB, uid],
    );
    bCode = "inserted";
    await admin.query("ROLLBACK");
  } catch (e) {
    await admin.query("ROLLBACK");
    bCode = e.code ?? String(e);
  }
  bCode === "42501"
    ? ok("B 跨组织写入被 WITH CHECK 拒绝（42501）")
    : fail(`B 期望 42501，实际 ${bCode}`);

  // C. tenant 未设上下文 → 断路零行
  await admin.query("BEGIN");
  await admin.query("SET LOCAL ROLE rabbit_tenant");
  const cCases = await admin.query(inFix("functional_cases"), [[caseA, caseB]]);
  await admin.query("ROLLBACK");
  cCases.rowCount === 0 ? ok("C 未设上下文断路零行") : fail(`C 期望 0 行，实际 ${cCases.rowCount}`);

  // D. admin（owner）豁免全可见
  const dCases = await admin.query(inFix("functional_cases"), [[caseA, caseB]]);
  dCases.rowCount === 2 ? ok("D admin 豁免全可见") : fail(`D 期望 2 行，实际 ${dCases.rowCount}`);

  // E. 排除面 comments：tenant 可写（无策略，行为同历史）
  let eErr = null;
  try {
    await admin.query("BEGIN");
    await admin.query("SET LOCAL ROLE rabbit_tenant");
    await admin.query("SELECT set_config('app.tenant_id', $1, true)", [orgA]);
    await admin.query(
      `INSERT INTO comments (id, entity_type, entity_id, user_id, content, updated_at) VALUES ($1, 'functional_case', $2, $3, 'rlsv', now())`,
      [randomUUID(), caseA, uid],
    );
    await admin.query("ROLLBACK");
  } catch (e) {
    await admin.query("ROLLBACK");
    eErr = e;
  }
  eErr
    ? fail(`E comments 应可写（排除面），实际报 ${eErr.code}`)
    : ok("E 排除面 comments tenant 可写");
} catch (e) {
  fail(`未预期异常：${e.code ?? ""} ${e.message}`);
} finally {
  // 清场（先冲掉可能残留的事务，再按依赖序删夹具）
  await admin.query("ROLLBACK").catch(() => {});
  await admin.query(`DELETE FROM functional_cases WHERE id = ANY($1)`, [[caseA, caseB]]);
  await admin.query(`DELETE FROM module_nodes WHERE id = ANY($1)`, [[modA, modB]]);
  await admin.query(`DELETE FROM projects WHERE id = ANY($1)`, [[projA, projB]]);
  await admin.query(`DELETE FROM "Organization" WHERE id = ANY($1)`, [[orgA, orgB]]);
  await admin.query(`DELETE FROM "User" WHERE id = $1`, [uid]);
  await admin.end();
}

console.log(failed ? "rls-verify: FAILED" : "rls-verify: ALL PASS");
process.exit(failed ? 1 : 0);
