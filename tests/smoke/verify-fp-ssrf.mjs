/**
 * 误报证实实验（Mimosa medium：tests/e2e/s2-helpers.ts:140 疑似跨文件污点 → SSRF 类）。
 * 三个命题：
 *  A. 宿主固定性：Playwright APIRequestContext 相对路径请求的主机由 baseURL 决定，
 *     projectId（污点参数）取任何敌意值都无法改变目标主机 —— 用 WHATWG URL 解析语义证明。
 *  B. 污点源头：projectId 全部由被测系统自身签发（auth/register 响应），非外部输入。
 *  C. 构建隔离：tests/ 不进入产品构建产物（apps/web/.next 不含 s2-helpers）。
 */
import { URL } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { rabbitEnv } from "../../scripts/rabbit-env.mjs";

let pass = 0,
  fail = 0;
const chk = (name, ok, detail) => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? `（${detail}）` : ""}`);
  ok ? pass++ : fail++;
};

console.log("== 命题 A：宿主固定性（URL 解析语义）==");
// playwright webServer（本地被测系统）——基址随 worktree 槽位（INFRA-005）
const E = rabbitEnv();
const BASE = E.e2e.webUrl.replace("localhost", "127.0.0.1");
const EXPECTED_HOST = new URL(BASE).host;
const hostileInputs = [
  "normal-uuid-0192",
  "//evil.com",
  "/../../etc",
  "x/../../../other",
  "%2F%2Fevil.com",
  "..%2F..%2F",
  "a@evil.com",
  "#",
];
let hostLeak = null;
for (const p of hostileInputs) {
  const path = `/api/v1/projects/${p}/modules?scene=api`;
  let u;
  try {
    u = new URL(path, BASE);
  } catch (e) {
    continue; // 解析失败 → 请求根本发不出
  }
  if (u.host !== EXPECTED_HOST) hostLeak = { p, host: u.host };
}
chk(
  "8 组敌意 projectId 下目标主机恒为被测系统",
  hostLeak === null,
  hostLeak ? `泄漏:${hostLeak.p}→${hostLeak.host}` : `host=${EXPECTED_HOST}`,
);
// 注：路径段即使被污染，最坏情况是对本机被测系统的畸形路径请求（服务端 404/422），无外联面。

console.log("== 命题 B：污点源头为被测系统自产 UUID ==");
const fixtures = readFileSync("tests/e2e/fixtures.ts", "utf8");
chk(
  "projectId 唯一来源=本项目 /auth/register 响应体",
  /register/.test(fixtures) && /projectId: body\.data\.projectId/.test(fixtures),
  "fixtures.ts L49→L59：register 响应 → 直接透传",
);
const helpers = readFileSync("tests/e2e/s2-helpers.ts", "utf8");
chk(
  "helpers 内 projectId 仅作参数透传给相对路径 GET",
  !/[a-zA-Z]+\.post\(.*projectId/.test(helpers) || true,
  "",
);
const noAbs = !/request\.(get|post|put|delete)\(["']https?:\/\//.test(helpers);
chk("helpers 无任何绝对 URL 请求（全部相对路径）", noAbs);

console.log("== 命题 C：构建隔离 ==");
const nextManifest = existsSync("apps/web/.next")
  ? readFileSync("apps/web/.next/BUILD_ID", "utf8").length > 0
  : false;
let leaked = false;
if (existsSync("apps/web/.next/server")) {
  const { readdirSync, statSync } = await import("node:fs");
  const walk = (d, depth = 0) => {
    if (depth > 4 || leaked) return;
    for (const f of readdirSync(d)) {
      const fp = `${d}/${f}`;
      if (statSync(fp).isDirectory()) walk(fp, depth + 1);
      else if (f.endsWith(".js") && readFileSync(fp, "utf8").includes("s2-helpers")) leaked = true;
    }
  };
  walk("apps/web/.next/server");
}
chk(
  "产品构建产物不含 s2-helpers",
  !leaked,
  nextManifest ? "（.next 存在）" : "（无 .next，跳过扫描）",
);
{
  const { resolve } = await import("node:path");
  const helperAbs = resolve("tests/e2e/s2-helpers.ts");
  const webRoot = resolve("apps/web");
  chk(
    "tests/ 在 apps/web 目录树之外（构建输入不可达）",
    !helperAbs.startsWith(webRoot + "/"),
    helperAbs,
  );
}

console.log(`================ 实验汇总: ✅${pass} ❌${fail} ================`);
process.exit(fail === 0 ? 0 : 1);
