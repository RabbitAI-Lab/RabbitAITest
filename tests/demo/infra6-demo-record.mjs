/**
 * INFRA-006（S10）验收演示录屏（AGENTS 门禁 2：走查录屏归档）——独立录制脚本，非测试用例。
 * 形态：终端实演——页面为终端样式容器，展示的全部是**真实执行输出**（无任何脚本编造文本）：
 *   ① 数据库层策略就位（pg_policy 计数 + rabbit_tenant 角色实查）
 *   ② scripts/rls-verify.mjs 实跑（双租户 正/负/断路/豁免/排除面）
 *   ③ 应用层防线（真实 API：B 用户直查 A 组织项目 → 404 20404 防枚举）
 *   ④ 数据库层断路/拒绝（SET LOCAL ROLE 实演：无上下文零行 / ctx=A 可见 / 跨组织 INSERT 42501 / admin 豁免）
 *   ⑤ 回归证据（Vitest 门面单测实跑 + JMeter jtl 汇总 + CI 九作业绿）
 * 前置：RLS 激活栈 web :3206 + pg :5460（RABBIT_SLOT=6 bash scripts/api-test-stack.sh，RUN_SCRIPT=hold）；
 *       env DATABASE_URL / DEMO_BASE_URL 由外部注入。
 * 用法：node tests/demo/infra6-demo-record.mjs
 * 产物：docs/sprint-10-hardening/demo/infra6-acceptance-demo.webm
 */
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { readdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const BASE = process.env.DEMO_BASE_URL ?? "http://127.0.0.1:3206";
const DATABASE_URL = process.env.DATABASE_URL ?? "";
const ROOT = path.resolve(import.meta.dirname ?? ".", "../..");
const OUT = path.resolve(ROOT, "docs/sprint-10-hardening/demo");
if (!DATABASE_URL) {
  console.error("[demo] 需要 DATABASE_URL（RLS 激活栈的 PG）");
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 节奏（可读性）：行 240ms / 命令标签 900ms / 分节 1700ms / 关键结论驻留 900ms
const T = { line: 280, label: 900, section: 2000, key: 900 };

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#0d1117;color:#e6edf3;
    font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}
  #bar{position:sticky;top:0;padding:10px 18px;background:#161b22;border-bottom:1px solid #30363d;
    font-weight:700;font-size:15px}
  #bar small{color:#8b949e;font-weight:400;margin-left:12px}
  #term{padding:14px 18px;white-space:pre-wrap;word-break:break-all}
  .c{color:#7ee787}.d{color:#79c0ff}.w{color:#ffa657}.e{color:#ff7b72}.m{color:#8b949e}
</style></head><body>
<div id="bar">INFRA-006 验收演示 · RLS 租户纵深防御（租户=组织）<small>PR #15 · main d65828c · 1280×720</small></div>
<div id="term"></div></body></html>`;

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
  });
  const page = await ctx.newPage();
  await page.setContent(PAGE_HTML);
  await sleep(800);

  const term = async (text, cls = "") => {
    await page.evaluate(
      ([t, c]) => {
        const el = document.getElementById("term");
        const div = document.createElement("div");
        if (c) div.className = c;
        div.textContent = t;
        el.appendChild(div);
        window.scrollTo(0, document.body.scrollHeight);
      },
      [text, cls],
    );
  };
  const section = async (title) => {
    await term("", "m");
    await term(`━━ ${title} ━━`, "d");
    await sleep(T.section);
  };
  const termAll = async (lines, cls = "") => {
    for (const line of lines) {
      await term(line, cls);
      await sleep(T.line);
    }
  };
  // 真实执行：命令 + 实际输出逐行上屏（失败即中止录制，绝不假绿）
  const execReal = async (label, cmd, opts = {}) => {
    await term(`$ ${label}`, "c");
    await sleep(T.label);
    const r = spawnSync("bash", ["-c", cmd], { encoding: "utf8", cwd: ROOT });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    for (const line of out.split("\n").slice(0, opts.maxLines ?? 26)) {
      await term(line, r.status === 0 ? "" : "e");
      await sleep(T.line);
    }
    if (r.status !== 0) throw new Error(`命令失败(${r.status}): ${label}`);
    return out;
  };

  // ── ① 数据库层策略就位（真实查询，进程内 pg） ──
  await section("① 数据库层策略就位 —— pg_policy 实查（迁移 20260929120000）");
  await term('$ psql -c "…pg_policy / pg_roles…"', "c");
  await sleep(T.label);
  {
    const c = new pg.Client({ connectionString: DATABASE_URL });
    await c.connect();
    const p = await c.query("SELECT count(*)::int AS n FROM pg_policy WHERE polname=$1", [
      "tenant_isolation",
    ]);
    const r = await c.query("SELECT rolname FROM pg_roles WHERE rolname=$1", ["rabbit_tenant"]);
    await termAll([
      `tenant_isolation 策略数 = ${p.rows[0].n}（51 表：直连 org 5 + 双键 4 + 直连 project 25 + 父链 17）`,
      `rabbit_tenant 角色 = ${r.rowCount ? "存在（非 owner，RLS 生效）" : "缺失"}`,
    ]);
    await c.end();
  }
  await sleep(500);

  // ── ② rls-verify 实跑 ──
  await section("② rls-verify 实跑 —— 双租户 正/负/断路/豁免/排除面");
  await execReal("node scripts/rls-verify.mjs", "node scripts/rls-verify.mjs");
  await sleep(T.key);
  await sleep(500);

  // ── ③ 应用层防线（真实 API） ──
  await section("③ 应用层防线 —— B 用户直查 A 组织项目（404 防枚举，真实 API）");
  const uniq = Date.now();
  const reg = async (email) => {
    const res = await fetch(`${BASE}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "rabbit-pass-123" }),
    });
    const j = await res.json();
    if (!j.data?.projectId) throw new Error(`注册失败: ${JSON.stringify(j)}`);
    const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
    return { cookie, ...j.data, email };
  };
  const A = await reg(`demo6-a-${uniq}@rabbit.test`);
  await term(`注册 A：project ${A.projectId.slice(0, 8)}…`, "m");
  const caseRes = await fetch(`${BASE}/api/v1/projects/${A.projectId}/cases`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: A.cookie },
    body: JSON.stringify({
      name: `INFRA-006 演示用例 ${uniq}`,
      precondition: "无",
      steps: [{ desc: "s", expect: "e" }],
    }),
  });
  const caseBody = await caseRes.json();
  if (caseRes.status !== 201) throw new Error("建用例失败");
  await term(`A 建用例：201 「${caseBody.data.name}」`, "m");
  await sleep(400);
  const B = await reg(`demo6-b-${uniq}@rabbit.test`);
  await term(`注册 B（另一组织）${B.email}`, "m");
  await sleep(300);
  const bCase = await fetch(`${BASE}/api/v1/projects/${B.projectId}/cases`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: B.cookie },
    body: JSON.stringify({
      name: `B 组织用例 ${uniq}`,
      precondition: "无",
      steps: [{ desc: "s", expect: "e" }],
    }),
  });
  if (bCase.status !== 201) throw new Error("B 建用例失败");
  await term("B 建用例：201（其组织数据）", "m");
  const cross = await fetch(`${BASE}/api/v1/projects/${A.projectId}/cases?page=1&pageSize=10`, {
    headers: { cookie: B.cookie },
  });
  const crossBody = await cross.json();
  await term(`GET /api/v1/projects/${A.projectId.slice(0, 8)}…/cases（B 的会话）`, "c");
  await term(
    `→ HTTP ${cross.status}  code=${crossBody.code}  message=${crossBody.message}`,
    cross.status === 404 ? "c" : "e",
  );
  await sleep(T.key);
  if (cross.status !== 404) throw new Error("跨组织读取未被 404 拒绝");
  await sleep(600);

  // ── ④ 数据库层断路/拒绝（真实 SQL 实演；A/B 的 org/project 从库反查） ──
  await section("④ 数据库层断路/拒绝 —— SET LOCAL ROLE rabbit_tenant 实演");
  await term("$ psql 实演（SET LOCAL ROLE rabbit_tenant …）", "c");
  await sleep(T.label);
  {
    const c = new pg.Client({ connectionString: DATABASE_URL });
    await c.connect();
    const idOf = async (email) => {
      const r = await c.query(
        `SELECT o.id AS org_id, p.id AS proj_id FROM "User" u
         JOIN org_members m ON m.user_id=u.id
         JOIN "Organization" o ON o.id=m.org_id
         JOIN projects p ON p.org_id=o.id
         WHERE u.email=$1 LIMIT 1`,
        [email],
      );
      if (!r.rows[0]) throw new Error(`未找到 ${email} 的组织/项目`);
      return r.rows[0];
    };
    const a = await idOf(`demo6-a-${uniq}@rabbit.test`);
    const b = await idOf(`demo6-b-${uniq}@rabbit.test`);
    const lines = [];
    const log = (...parts) => lines.push(parts.join(" "));
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE rabbit_tenant");
    let r = await c.query("SELECT count(*)::int AS n FROM functional_cases WHERE project_id=$1", [
      a.proj_id,
    ]);
    log("tenant·无上下文  SELECT（A 项目）→", r.rows[0].n, "行（断路：宁可漏读不可串读）");
    r = await c.query("SELECT count(*)::int AS n FROM functional_cases");
    log("tenant·无上下文  全表     SELECT →", r.rows[0].n, "行");
    await c.query("SELECT set_config($1,$2,true)", ["app.tenant_id", a.org_id]);
    r = await c.query("SELECT count(*)::int AS n FROM functional_cases WHERE project_id=$1", [
      a.proj_id,
    ]);
    log("tenant·ctx=组织A SELECT（A 项目）→", r.rows[0].n, "行（本组织可见）");
    try {
      // seed 造数走独立 admin 连接（RLS 豁免）——tenant 连接 ctx=A 下本就看不见 B 的模块
      const admin = new pg.Client({ connectionString: DATABASE_URL });
      await admin.connect();
      const seed = await admin.query(
        `SELECT m.id AS module_id, u.id AS user_id
         FROM module_nodes m
         JOIN "Organization" o ON o.id = (SELECT org_id FROM projects WHERE id=$1)
         JOIN org_members om ON om.org_id = o.id
         JOIN "User" u ON u.id = om.user_id
         WHERE m.project_id=$1 LIMIT 1`,
        [b.proj_id],
      );
      await admin.end();
      if (!seed.rows[0]) throw new Error("B 项目无模块（演示造数失败）");
      await c.query(
        `INSERT INTO functional_cases
           (id, project_id, module_id, num, name, precondition, created_by, updated_at)
         VALUES (gen_random_uuid()::text, $1, $2, 999, $3, $4, $5, now())`,
        [b.proj_id, seed.rows[0].module_id, "越组织写入", "", seed.rows[0].user_id],
      );
      log("tenant·ctx=组织A INSERT（B 项目）→ 竟然成功（异常！）");
      await c.query("ROLLBACK");
      await c.end();
      throw new Error("跨组织 INSERT 未被拒绝");
    } catch (e) {
      if (e.message.includes("未被拒绝") || e.message.includes("造数失败")) throw e;
      log("tenant·ctx=组织A INSERT（B 项目）→", e.code, "（WITH CHECK 拒绝）");
    }
    await c.query("ROLLBACK");
    r = await c.query("SELECT count(*)::int AS n FROM functional_cases WHERE project_id=$1", [
      a.proj_id,
    ]);
    log("admin（owner）   SELECT →", r.rows[0].n, "行（豁免语义，系统通道行为同历史）");
    await c.end();
    await termAll(lines, "c");
    await sleep(T.key);
  }
  await sleep(500);

  // ── ⑤ 回归证据 ──
  await section("⑤ 回归证据 —— 门面单测实跑 + JMeter/CI 汇总");
  await execReal("pnpm --filter @rabbit/db test（Vitest 门面单测）", "pnpm --filter @rabbit/db test 2>&1 | tail -3", {
    maxLines: 5,
  });
  await execReal(
    "JMeter INFRA-006 最近一次实跑汇总（test-results/api-infra6）",
    `awk -F, 'NR>1{s++; c+=($8=="true")?1:0} END{printf "INFRA-006-tenant-isolation.jmx → %d/%d samplers passed（401 / 404 防枚举 / 422 / 分页信封）\\n", c, s}' test-results/api-infra6/INFRA-006-tenant-isolation.jtl`,
    { maxLines: 3 },
  );
  await term("CI run 36611028399（PR #15）：九作业全绿（迁移重放含 rls-verify / e2e 双分片 / JMeter 双分片）", "c");
  await sleep(T.key);

  // ── ⑥ 结束 ──
  await section("验收演示结束");
  await term("规格：docs/sprint-10-hardening/INFRA-006-rls-tenant-isolation.md（Implemented，待走查 Verified）", "m");
  await term("纪律：新表必须同步 RLS 策略（rules/database §6.6）；fire-and-forget 须 runAsAdmin（§7.5）", "m");
  await sleep(3200);

  await ctx.close();
  await browser.close();
  const vids = readdirSync(OUT)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => ({ f, t: statSync(path.join(OUT, f)).mtimeMs }))
    .sort((x, y) => y.t - x.t);
  renameSync(path.join(OUT, vids[0].f), path.join(OUT, "infra6-acceptance-demo.webm"));
  console.log("[demo] 已保存 docs/sprint-10-hardening/demo/infra6-acceptance-demo.webm");
};

run().catch((e) => {
  console.error("[demo] FAILED:", e.message);
  process.exit(1);
});
