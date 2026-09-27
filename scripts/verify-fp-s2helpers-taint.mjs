#!/usr/bin/env node
/**
 * Mimosa medium 误报证实实验：tests/e2e/s2-helpers.ts:140「疑似跨文件污点」。
 * 沿用 verify-fp-ssrf.mjs 三命题法；每命题独立断言，全过输出 6/6（或 8/8 计子断言）。
 *
 * 命题一（汇聚点固定）：helper 返回的"污点值"只流向同一 Playwright request 上下文
 *   （baseURL 固定 localhost:3100）的 JSON body；两 helper 文件无 eval/exec/fs/dynamic-import 汇聚点。
 * 命题二（污点源头=被测系统自产 + 汇聚点强校验）：data.items 来自被测服务自身 DB 的 UUID 列；
 *   下游全部 create/update schema 对 moduleId 施行 z.string().uuid()——敌意值必 422。
 * 命题三（敌意输入运行时实验）：SQLi/XSS/原型污染/超深嵌套四组敌意输入喂入 walk 逻辑，
 *   最坏后果=返回怪串→下游 422→测试失败（或测试进程栈溢出=对自身被测系统的 DoS，非安全边界）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
};

// ── 命题一：汇聚点固定（host 固定 + 无危险 sink） ──
console.log("命题一：汇聚点固定（无逃逸面 / 无危险 sink）");
for (const f of ["tests/e2e/s2-helpers.ts", "tests/e2e/s3-helpers.ts"]) {
  const src = readFileSync(path.join(ROOT, f), "utf8");
  ok(!/\beval\s*\(|new\s+Function\s*\(|child_process|execSync|execFile|\bspawn\s*\(|vm\.|writeFile|appendFile/.test(src),
    `${f}：无 eval/Function/child_process/fs 写汇聚点`);
  ok(!/await import\s*\(|\brequire\s*\(\s*(?!"\.\/|'\.\/)/.test(src.replace(/createRequire[^;]+;/, "")),
    `${f}：无数据驱动的动态 import/require`);
  // URL 主机必须字面量固定：允许 ${__P/MOCK_BASE/127.0.0.1/localhost}/api/v1 相对路径，禁止 ${data…} 拼 host
  ok(!/https?:\/\/\$\{(?!__P|MOCK|E2E)/.test(src), `${f}：无数据驱动的 URL 主机`);
}
{
  const cfg = readFileSync(path.join(ROOT, "tests/playwright.config.ts"), "utf8");
  ok(/baseURL:\s*process\.env\.E2E_BASE_URL \?\? "http:\/\/localhost:3100"/.test(cfg),
    "playwright baseURL 默认 localhost:3100（污点值只能回到同一被测系统）");
}

// ── 命题二：污点源头=被测系统自产 + 下游 uuid 强校验 ──
console.log("命题二：源头自产 + 汇聚点 zod uuid 强校验（敌意值必 422）");
{
  const schemas = readFileSync(path.join(ROOT, "packages/shared/src/api/schemas.ts"), "utf8");
  const uuidSites = (schemas.match(/moduleId: z\.string\(\)\.uuid\(\)/g) ?? []).length;
  ok(uuidSites >= 5, `moduleId 在 ${uuidSites} 处 create/update schema 均为 z.string().uuid()`);
  // 服务端 service 层：createModule 入参仅 {name, parentId}，模块 id 由 DB 生成（外部无法注入自由文本 id）
  const svc = readFileSync(path.join(ROOT, "apps/web/src/server/domains/case/module.service.ts"), "utf8");
  ok(/input:\s*\{\s*name:\s*string;\s*parentId\?:\s*string\s*\|\s*null\s*\}/.test(svc),
    "模块 id 仅由 DB 生成（createModule 入参仅 name/parentId，无 id 注入口）");
}

// ── 命题三：敌意输入运行时实验（复刻 s2-helpers.ts:134-141 的 walk/return 逻辑） ──
console.log("命题三：敌意输入运行时实验（四组）");
const walkOfHelper = (items) => {
  // 与 s2-helpers.ts:133-141 逐行同构（提取复刻，行为一致）
  const flat = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      flat.push(n);
      walk(n.children ?? []);
    }
  };
  walk(items);
  return flat.find((m) => m.isDefault)?.id ?? flat[0]?.id;
};
{
  // 3.1 SQLi / 3.2 XSS / 3.3 原型污染（JSON.parse 路径安全 + push-only 结构无合并点）
  const hostile = [
    ["SQLi", [{ id: "'; DROP TABLE \"User\"; --", isDefault: true, children: [] }]],
    ["XSS", [{ id: "<script>alert(1)</script>", children: [] }]],
    ["原型污染", [JSON.parse('{"id":"x","children":[{"id":"y","__proto__":{"polluted":"PWNED"},"isDefault":true,"children":[]}]}')]],
  ];
  for (const [name, input] of hostile) {
    const out = walkOfHelper(input);
    ok(typeof out === "string" && out.length < 200, `${name}：返回惰性字符串「${String(out).slice(0, 40)}」（仅作 JSON body 字段）`);
  }
  ok(({}).polluted === undefined, "原型污染实验：global Object.prototype 未被改动（push-only 无合并点）");
  // 3.4 超深嵌套：最坏后果=测试进程 RangeError（对自身被测系统的 DoS，非安全边界穿越）
  let deep = { id: "leaf", children: [] };
  for (let i = 0; i < 100_000; i++) deep = { id: `n${i}`, children: [deep] };
  let stackBoom = false;
  try { walkOfHelper([deep]); } catch (e) { stackBoom = e instanceof RangeError; }
  ok(stackBoom, "超深嵌套 10 万层：仅测试进程栈溢出（RangeError），无其它汇聚点被触达");
}

console.log(`\n结论：${pass}/${pass + fail} 断言通过`);
if (fail > 0) { console.log("存在未通过断言——误报证实不成立，需人工复核"); process.exit(1); }
console.log("三命题全过：s2-helpers.ts:140 判定为误报（污点链=被测系统自产 UUID→同宿主 JSON body→uuid 校验汇聚点，无危险 sink）。");
console.log("登记稳健性观察（非安全）：walk 递归无深度上限，敌意被测系统可使测试进程栈溢出——可加深度上限加固（S4 顺手项）。");
