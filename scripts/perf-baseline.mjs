#!/usr/bin/env node
/**
 * 性能基准（QA-001 §2；需求文档 §四 三指标）：
 *   场景 A：万级用例列表+筛选 P95 < 1000ms（采样 30）
 *   场景 B：报告详情 P95 < 2000ms（采样 30；先跑一个 api_debug 任务产报告）
 *   场景 C：100 并发接口任务（quick=20）全部终态 SUCCESS——失败/超时即红；吞吐/P95 为信息项
 * 产出：test-results/perf/perf-baseline-report.{json,md}；任一阈值不过 → 退出码 1。
 * 用法：node scripts/perf-baseline.mjs [--scope quick|full] [--web http://localhost:3000]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const scope = args.includes("--scope") ? args[args.indexOf("--scope") + 1] : "full";
const WEB = args.includes("--web")
  ? args[args.indexOf("--web") + 1]
  : (process.env.WEB_URL ?? "http://localhost:3000");
const MOCK = process.env.PERF_MOCK_URL ?? `http://127.0.0.1:${process.env.MOCK_PORT ?? 4000}`;
const CONCUR = scope === "quick" ? 20 : 100;
const SAMPLES = 30;
const THRESH = { listMs: 1000, reportMs: 2000 };
const EMAIL = process.env.PERF_EMAIL ?? "admin@rabbit.test";
const PASSWORD = process.env.PERF_PASSWORD ?? "rabbit-admin-123";

const report = {
  scope,
  web: WEB,
  mock: MOCK,
  node: process.version,
  at: new Date().toISOString(),
  scenarios: {},
};
let failures = [];

function p95(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] ?? 0;
}

let cookie = "";
async function api(pathname, init = {}) {
  const res = await fetch(`${WEB}${pathname}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return res;
}

async function login() {
  const res = await api("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`登录失败 HTTP ${res.status}（${EMAIL}）——检查种子与 web 地址`);
}

async function projectIdByName(name) {
  const res = await api(`/api/v1/personal/projects`);
  if (res.ok) {
    const j = await res.json();
    const hit = (j.data ?? []).find((p) => p.name === name);
    if (hit) return hit.id;
  }
  throw new Error(`未找到项目 ${name}（先跑 perf-seed）`);
}

async function scenarioList(pid) {
  const variants = {
    plain: `/api/v1/projects/${pid}/cases?page=1&pageSize=20`,
    keyword: `/api/v1/projects/${pid}/cases?page=1&pageSize=20&keyword=${encodeURIComponent("下单")}`,
    level: `/api/v1/projects/${pid}/cases?page=1&pageSize=20&level=P1`,
  };
  const out = {};
  for (const [k, url] of Object.entries(variants)) {
    for (let i = 0; i < 3; i++) await api(url); // 预热
    const times = [];
    for (let i = 0; i < SAMPLES; i++) {
      const t0 = performance.now();
      const res = await api(url);
      times.push(performance.now() - t0);
      if (res.status !== 200) throw new Error(`列表 ${k} HTTP ${res.status}`);
    }
    out[k] = {
      p95Ms: Math.round(p95(times)),
      meanMs: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
    };
    if (out[k].p95Ms > THRESH.listMs)
      failures.push(`场景A ${k} P95 ${out[k].p95Ms}ms > ${THRESH.listMs}ms`);
  }
  return out;
}

async function submitTask(pid, clientTaskId, url = `${MOCK}/perf/echo`) {
  const res = await api(`/api/v1/projects/${pid}/exec-tasks`, {
    method: "POST",
    body: JSON.stringify({
      type: "api_debug",
      clientTaskId,
      request: {
        method: "GET",
        url,
        headers: [],
        query: [],
        body: { kind: "none" },
        auth: { kind: "none" },
        timeoutMs: 10000,
        followRedirects: false,
        skipPre: false,
        skipPost: false,
      },
      asserts: [{ kind: "status_code", path: "", op: "eq", expected: "200" }],
      pre: [],
      post: [],
      extracts: [],
    }),
  });
  if (res.status !== 201) throw new Error(`任务提交 HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()).data.taskId;
}

async function waitTerminal(pid, taskId, timeoutMs = 120_000) {
  const t0 = Date.now();
  for (;;) {
    const res = await api(`/api/v1/projects/${pid}/reports/${taskId}`);
    if (res.ok) {
      const j = (await res.json()).data;
      if (["SUCCESS", "FAILED", "STOPPED"].includes(j.status)) return j.status;
    }
    if (Date.now() - t0 > timeoutMs) return "TIMEOUT";
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function scenarioReport(pid) {
  const taskId = await submitTask(pid, `perf-report-${Date.now()}`);
  const st = await waitTerminal(pid, taskId);
  if (st !== "SUCCESS") throw new Error(`场景B 前置任务终态 ${st}`);
  const url = `/api/v1/projects/${pid}/reports/${taskId}`;
  for (let i = 0; i < 3; i++) await api(url);
  const times = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = performance.now();
    const res = await api(url);
    times.push(performance.now() - t0);
    if (res.status !== 200) throw new Error(`报告详情 HTTP ${res.status}`);
  }
  const p = {
    p95Ms: Math.round(p95(times)),
    meanMs: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
  };
  if (p.p95Ms > THRESH.reportMs)
    failures.push(`场景B 报告详情 P95 ${p.p95Ms}ms > ${THRESH.reportMs}ms`);
  return p;
}

async function scenarioConcurrent(pid) {
  const t0 = Date.now();
  const ids = await Promise.all(
    Array.from({ length: CONCUR }, (_, i) => submitTask(pid, `perf-c${scope}-${Date.now()}-${i}`)),
  );
  const stats = await Promise.all(ids.map((id) => waitTerminal(pid, id, 300_000)));
  const wallMs = Date.now() - t0;
  const success = stats.filter((s) => s === "SUCCESS").length;
  const outcome = {
    total: CONCUR,
    success,
    notSuccess: CONCUR - success,
    wallMs,
    perTaskWallMs: Math.round(wallMs / CONCUR),
  };
  if (success !== CONCUR)
    failures.push(
      `场景C ${CONCUR - success}/${CONCUR} 任务未 SUCCESS（${[...new Set(stats)].join(",")}）`,
    );
  return outcome;
}

// ── 主流程 ──
await login();
const pid = await projectIdByName("性能基线专用");
console.log(`基准开始：scope=${scope} web=${WEB} mock=${MOCK} project=${pid.slice(0, 8)}`);

console.log("场景 A：万级用例列表…");
report.scenarios.list = await scenarioList(pid);
console.log(`  ${JSON.stringify(report.scenarios.list)}`);

console.log("场景 B：报告详情…");
report.scenarios.report = await scenarioReport(pid);
console.log(`  ${JSON.stringify(report.scenarios.report)}`);

console.log(`场景 C：${CONCUR} 并发接口任务…`);
report.scenarios.concurrent = await scenarioConcurrent(pid);
console.log(`  ${JSON.stringify(report.scenarios.concurrent)}`);

report.failures = failures;
const dir = path.join(ROOT, "test-results", "perf");
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "perf-baseline-report.json"), JSON.stringify(report, null, 2));
const md = [
  `# 性能基线报告（QA-001）`,
  ``,
  `- 口径：${scope} · ${report.at} · node ${report.node} · web ${WEB}`,
  ``,
  `| 场景 | 指标 | 值 | 阈值 | 结论 |`,
  `| ---- | ---- | -- | ---- | ---- |`,
  ...Object.entries(report.scenarios.list).map(
    ([k, v]) =>
      `| A 列表·${k} | P95 | ${v.p95Ms}ms | < ${THRESH.listMs}ms | ${v.p95Ms <= THRESH.listMs ? "✅" : "❌"} |`,
  ),
  `| B 报告详情 | P95 | ${report.scenarios.report.p95Ms}ms | < ${THRESH.reportMs}ms | ${report.scenarios.report.p95Ms <= THRESH.reportMs ? "✅" : "❌"} |`,
  `| C 并发任务 | 全成功 | ${report.scenarios.concurrent.success}/${report.scenarios.concurrent.total} | = ${report.scenarios.concurrent.total} | ${report.scenarios.concurrent.success === report.scenarios.concurrent.total ? "✅" : "❌"} |`,
  `| C 并发任务 | 全程耗时 | ${report.scenarios.concurrent.wallMs}ms | 信息项 | — |`,
  ``,
  failures.length ? `## 失败\n${failures.map((f) => `- ❌ ${f}`).join("\n")}` : `全部通过 ✅`,
  ``,
].join("\n");
writeFileSync(path.join(dir, "perf-baseline-report.md"), md);
console.log(`\n报告：${path.relative(ROOT, dir)}/perf-baseline-report.md`);
if (failures.length) {
  console.error(failures.map((f) => `❌ ${f}`).join("\n"));
  process.exit(1);
}
console.log("全部通过 ✅");
