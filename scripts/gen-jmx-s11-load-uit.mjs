#!/usr/bin/env node
/**
 * S11 JMeter 用例生成器：LOAD-003 性能测试 / UIT-002 UI 测试 两份计划。
 * rules/testing §2：四类场景（正常/401·403·404/422/分页信封）× 四项断言（HTTP/code/JSONPath/耗时）。
 * License 门控（ENTP-007 口径）：生成期同密钥预计算 License UDV（含 LOAD_TEST/UI_TEST 特性）；
 * G0 组 admin 登录+License 幂等覆盖；门控断言=403·90001（无 License 组先移除 License 再断言）。
 * 栈前提：api-test-stack.sh（OUTBOUND_ALLOW_PRIVATE=1、LICENSE_SIGNING_SECRET 缺省同密钥）。
 * 生成物提交入库；重跑 --force 覆盖。
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac, randomUUID } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FORCE = process.argv.includes("--force");
const OUT = path.join(ROOT, "tests/api");

const esc = (s) =>
  String(s)
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;")
    .split('"')
    .join("&quot;");

/** 采样器：四项断言；status>=400 assume_success；extract=JSONPostProcessor。 */
function sampler(d) {
  const status = d.status ?? 200;
  const code = d.code ?? 0;
  const assume =
    status >= 400 ? `\n            <boolProp name="Assertion.assume_success">true</boolProp>` : "";
  const assertions = [];
  assertions.push(`
          <ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="HTTP ${status}">
            <collectionProp name="Asserion.test_strings"><stringProp name="49586">${status}</stringProp></collectionProp>
            <stringProp name="Assertion.test_field">Assertion.response_code</stringProp>${assume}
            <intProp name="Assertion.test_type">8</intProp>
          </ResponseAssertion>
          <hashTree/>`);
  assertions.push(`
          <JSONPathAssertion guiclass="JSONPathAssertionGui" testclass="JSONPathAssertion" testname="code=${code}">
            <stringProp name="JSON_PATH">$.code</stringProp>
            <stringProp name="EXPECTED_VALUE">${code}</stringProp>
            <boolProp name="JSONVALIDATION">true</boolProp>
          </JSONPathAssertion>
          <hashTree/>`);
  for (const [jp, expect] of d.field ? [d.field] : []) {
    assertions.push(`
          <JSONPathAssertion guiclass="JSONPathAssertionGui" testclass="JSONPathAssertion" testname="field ${jp}=${esc(expect)}">
            <stringProp name="JSON_PATH">${esc(jp)}</stringProp>
            <stringProp name="EXPECTED_VALUE">${esc(expect)}</stringProp>
            <boolProp name="JSONVALIDATION">true</boolProp>
          </JSONPathAssertion>
          <hashTree/>`);
  }
  for (const [jp, frag] of d.contains ? [d.contains] : []) {
    assertions.push(`
          <JSONPathAssertion guiclass="JSONPathAssertionGui" testclass="JSONPathAssertion" testname="contains ${esc(frag)}">
            <stringProp name="JSON_PATH">${esc(jp)}</stringProp>
            <stringProp name="EXPECTED_VALUE">${esc(frag)}</stringProp>
            <boolProp name="JSONVALIDATION">false</boolProp>
          </JSONPathAssertion>
          <hashTree/>`);
  }
  assertions.push(`
          <DurationAssertion guiclass="DurationAssertionGui" testclass="DurationAssertion" testname="&lt;${d.duration ?? 3000}ms">
            <stringProp name="DurationAssertion.duration">${d.duration ?? 3000}</stringProp>
          </DurationAssertion>
          <hashTree/>`);
  const extractDefs = (d.extracts ?? (d.extract ? [d.extract] : []))
    .map(
      (e) => `
          <JSONPostProcessor guiclass="JSONPostProcessorGui" testclass="JSONPostProcessor" testname="提取 ${e.var}">
            <stringProp name="JSONPostProcessor.referenceNames">${e.var}</stringProp>
            <stringProp name="JSONPostProcessor.jsonPathExprs">${esc(e.path)}</stringProp>
            <stringProp name="JSONPostProcessor.match_numbers">1</stringProp>
            <stringProp name="JSONPostProcessor.defaultValues">NOT_FOUND</stringProp>
          </JSONPostProcessor>
          <hashTree/>`,
    )
    .join("");
  const jsr = d.jsr223
    ? `
          <JSR223PostProcessor guiclass="TestBeanGUI" testclass="JSR223PostProcessor" testname="props 桥 ${esc(d.jsr223.name ?? "")}">
            <stringProp name="scriptLanguage">groovy</stringProp>
            <stringProp name="script">${esc(d.jsr223.script)}</stringProp>
          </JSR223PostProcessor>
          <hashTree/>`
    : "";
  let bodyProp = "";
  if (d.body !== undefined) {
    bodyProp = `
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments">
            <collectionProp name="Arguments.arguments">
              <elementProp name="" elementType="HTTPArgument">
                <boolProp name="HTTPArgument.always_encode">false</boolProp>
                <stringProp name="Argument.value">${esc(typeof d.body === "string" ? d.body : JSON.stringify(d.body))}</stringProp>
                <stringProp name="Argument.metadata">=</stringProp>
              </elementProp>
            </collectionProp>
          </elementProp>`;
  }
  return `
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${esc(d.name)}">${bodyProp}
          <stringProp name="HTTPSampler.domain">\${__P(HOST,localhost)}</stringProp>
          <stringProp name="HTTPSampler.port">\${__P(PORT,3100)}</stringProp>
          <stringProp name="HTTPSampler.path">${esc(d.path)}</stringProp>
          <stringProp name="HTTPSampler.method">${d.method}</stringProp>
          <boolProp name="HTTPSampler.use_keepalive">true</boolProp>
        </HTTPSamplerProxy>
        <hashTree>${extractDefs}${jsr}${assertions.join("")}
        </hashTree>`;
}

function threadGroup(name, elements, withCookie = true) {
  return `
      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="${esc(name)}">
        <stringProp name="ThreadGroup.num_threads">1</stringProp>
        <stringProp name="ThreadGroup.ramp_time">1</stringProp>
        <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController">
          <boolProp name="LoopController.continue_forever">false</boolProp>
          <stringProp name="LoopController.loops">1</stringProp>
        </elementProp>
      </ThreadGroup>
      <hashTree>
        ${
          withCookie
            ? `<CookieManager guiclass="CookiePanel" testclass="CookieManager" testname="Cookie">
          <boolProp name="CookieManager.clearEachIteration">false</boolProp>
        </CookieManager>
        <hashTree/>`
            : ""
        }
        ${elements.join("\n")}
      </hashTree>`;
}

function plan(title, vars, groups) {
  const varProps = Object.entries(vars)
    .map(
      ([k, v]) => `
          <elementProp name="${k}" elementType="Argument">
            <stringProp name="Argument.name">${k}</stringProp>
            <stringProp name="Argument.value">${esc(v)}</stringProp>
            <stringProp name="Argument.metadata">=</stringProp>
          </elementProp>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="${esc(title)}">
      <boolProp name="TestPlan.serialize_threadgroups">true</boolProp>
      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments">
        <collectionProp name="Arguments.arguments">${varProps}
        </collectionProp>
      </elementProp>
    </TestPlan>
    <hashTree>${groups.join("")}
    </hashTree>
  </hashTree>
</jmeterTestPlan>
`;
}

// ═══════ License 签发（与 web 同密钥同算法；含 LOAD_TEST/UI_TEST 特性） ═══════
const SECRET = process.env.LICENSE_SIGNING_SECRET ?? "rabbit-dev-license-secret";
function issueLicense(payload) {
  const seg = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", SECRET).update(seg).digest("base64url");
  return `RABBIT-ENT1.${seg}.${sig}`;
}
const LIC_FULL = issueLicense({
  lic: `RAB-JMX-S11-${randomUUID().slice(0, 8).toUpperCase()}`,
  edition: "ENTERPRISE",
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
  features: ["LOAD_TEST", "UI_TEST"],
});
// 特性缺失 License（不含 LOAD_TEST——断言 90005 特性未授权）
const LIC_NO_LOAD = issueLicense({
  lic: `RAB-JMX-NOL-${randomUUID().slice(0, 8).toUpperCase()}`,
  edition: "ENTERPRISE",
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
  features: ["UI_TEST"],
});

const TS = "${__time(yyyyMMddHHmmss)}";
const ADMIN_LOGIN = { email: "admin@rabbit.test", password: "rabbit-admin-123" };
const MOCK_BASE = "http://${__P(MOCKHOST,127.0.0.1)}:${__P(MOCKPORT,4020)}";

/** G0：admin 登录 → 添加全特性 License（幂等覆盖）。 */
const adminWithLicense = [
  sampler({
    name: "G0 admin 登录",
    method: "POST",
    path: "/api/v1/auth/login",
    body: ADMIN_LOGIN,
    field: ["$.code", "0"],
  }),
  sampler({
    name: "G0 添加 License（含 LOAD_TEST/UI_TEST）",
    method: "POST",
    path: "/api/v1/system/license",
    body: { code: "${LICENSE}" },
    field: ["$.data.edition", "ENTERPRISE"],
  }),
];

/** G9：admin 终态清理——移除 License（还原社区版，防污染后续计划）。 */
const adminCleanup = [
  sampler({
    name: "G9 admin 回会话",
    method: "POST",
    path: "/api/v1/auth/login",
    body: ADMIN_LOGIN,
    field: ["$.code", "0"],
  }),
  sampler({
    name: "G9 移除 License（还原社区版）",
    method: "DELETE",
    path: "/api/v1/system/license",
    field: ["$.data.edition", "COMMUNITY"],
  }),
];

/** 注册+取项目（emailVar：线程组独立邮箱变量——__time 秒级求值，共享变量同秒撞邮箱=10101 已注册）。 */
const registerSetup = (emailVar = "EMAIL") => [
  sampler({
    name: "T0 注册并取会话+项目",
    method: "POST",
    path: "/api/v1/auth/register",
    body: { email: `\${${emailVar}}`, password: "rabbit-pass-123" },
    status: 201,
    contains: ["$.data.projectId", "-"],
    extract: { var: "PROJECT_ID", path: "$.data.projectId" },
    duration: 8000,
    jsr223: { name: "PROJECT_ID→props（跨组）", script: "props.put('PROJECT_ID', vars.get('PROJECT_ID'))" },
  }),
];

const files = new Map();
const emit = (name, title, vars, groups) => files.set(name, plan(title, vars, groups));

// ═══════ LOAD-003 性能测试 ═══════
emit(
  "LOAD-003-load-tests.jmx",
  "LOAD-003 性能测试（CRUD/执行/停止/门控；四类场景）",
  {
    EMAIL: `jm-load3-a-${TS}@rabbit.test`,
    EMAIL_G2: `jm-load3-b-${TS}@rabbit.test`,
    EMAIL_G5: `jm-load3-c-${TS}@rabbit.test`,
    EMAIL_G6: `jm-load3-d-${TS}@rabbit.test`,
    LICENSE: LIC_FULL,
    LICENSE_NO_LOAD: LIC_NO_LOAD,
    TS,
  },
  [
    threadGroup("G0 admin+License（全特性）", adminWithLicense),
    threadGroup("G1 施压计划 CRUD 主链（正常+分页）", [
      ...registerSetup(),
      sampler({
        name: "T1-1 新建施压计划（tps 模式，mock /perf/echo）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/load-tests",
        body: {
          name: "jm-基线压测${TS}",
          target: { method: "GET", url: `${MOCK_BASE}/perf/echo` },
          pressure: { mode: "tps", durationSec: 10, targetTps: 5, rampSec: 2 },
          thresholds: { okRateMin: 50, p95MsMax: 5000, avgMsMax: 3000 },
        },
        status: 201,
        extract: { var: "LT_ID", path: "$.data.id" },
        contains: ["$.data.id", "-"],
        jsr223: { name: "LT_ID→props", script: "props.put('LT_ID', vars.get('LT_ID'))" },
      }),
      sampler({
        name: "T1-2 列表含新计划（分页信封）",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/load-tests?page=1&pageSize=20",
        contains: ["$.data.list[?(@.id=='${LT_ID}')].name", "jm-基线压测"],
        extracts: [
          { var: "LT_TOTAL", path: "$.data.total" },
          { var: "LT_PAGE", path: "$.data.page" },
        ],
        jsr223: {
          name: "分页信封核对",
          script: "if (vars.get('LT_TOTAL') == 'NOT_FOUND' || vars.get('LT_PAGE') != '1') { prev.setSuccessful(false); prev.setResponseMessage('分页信封缺失 total/page') }",
        },
      }),
      sampler({
        name: "T1-3 详情回读",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/load-tests/${LT_ID}",
        field: ["$.data.pressure.targetTps", "5"],
      }),
      sampler({
        name: "T1-4 更新（改 TPS）",
        method: "PUT",
        path: "/api/v1/projects/${PROJECT_ID}/load-tests/${LT_ID}",
        body: { pressure: { mode: "tps", durationSec: 12, targetTps: 8, rampSec: 3 } },
        field: ["$.data.pressure.targetTps", "8"],
      }),
      sampler({
        name: "T1-5 删除（软删）",
        method: "DELETE",
        path: "/api/v1/projects/${PROJECT_ID}/load-tests/${LT_ID}",
        field: ["$.data.id", "${LT_ID}"],
      }),
      sampler({
        name: "T1-6 删除后详情 404·90070",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/load-tests/${LT_ID}",
        status: 404,
        code: 90070,
      }),
    ]),
    threadGroup("G2 执行链路（run→metrics→stop→任务终态）", [
      ...registerSetup("EMAIL_G2"),
      sampler({
        name: "T2-0 重建计划（8s 小压力）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/load-tests",
        body: {
          name: "jm-执行链${TS}",
          target: { method: "GET", url: `${MOCK_BASE}/perf/echo` },
          pressure: { mode: "tps", durationSec: 8, targetTps: 5, rampSec: 0 },
          thresholds: { okRateMin: 50, p95MsMax: 8000, avgMsMax: 5000 },
        },
        status: 201,
        extract: { var: "LT2_ID", path: "$.data.id" },
      }),
      sampler({
        name: "T2-1 触发执行（202 异步）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/load-tests/${LT2_ID}/run",
        status: 202,
        extract: { var: "TASK_ID", path: "$.data.taskId" },
        jsr223: { name: "TASK_ID→props", script: "props.put('TASK_ID', vars.get('TASK_ID'))" },
      }),
      sampler({
        name: "T2-2 等引擎起压（5s）",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/load-tasks?page=1&pageSize=5",
        jsr223: { name: "sleep5s", script: "Thread.sleep(5000)" },
        contains: ["$.data.list[0].taskId", "-"],
      }),
      sampler({
        name: "T2-3 秒级度量回放（帧数组）",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/load-tasks/${TASK_ID}/metrics",
        contains: ["$.data.frames", "-"],
      }),
      sampler({
        name: "T2-4 停止施压",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/load-tasks/${TASK_ID}/stop",
        field: ["$.data.taskId", "${TASK_ID}"],
      }),
      sampler({
        name: "T2-5 等终态落库（6s）",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/load-tasks?page=1&pageSize=5",
        jsr223: { name: "sleep6s", script: "Thread.sleep(6000)" },
      }),
      sampler({
        name: "T2-6 任务列表含该任务（ABORTED/SUCCESS 之一）",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/load-tasks?page=1&pageSize=20",
        contains: ["$.data.list[?(@.taskId=='${TASK_ID}')].status", "-"],
      }),
      sampler({
        name: "T2-7 重复停止终态任务 409·90072",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/load-tasks/${TASK_ID}/stop",
        status: 409,
        code: 90072,
      }),
    ]),
    threadGroup("G3 无会话 401（无 Cookie）", [
      sampler({
        name: "T3-1 未登录建计划",
        method: "POST",
        path: "/api/v1/projects/\${__P(PROJECT_ID,NOT_FOUND)}/load-tests",
        body: { name: "x" },
        status: 401,
        code: 10001,
      }),
    ], false),
    threadGroup("G4 普通成员越权 403（注册普通用户）", [
      sampler({
        name: "T4-0 注册普通用户（无项目权限）",
        method: "POST",
        path: "/api/v1/auth/register",
        body: { email: "jm-load3-member${TS}@rabbit.test", password: "rabbit-pass-123" },
        status: 201,
        extract: { var: "MEMBER_PID", path: "$.data.projectId" },
        duration: 8000,
      }),
      sampler({
        name: "T4-1 普通用户跨项目读他人计划列表 404·20404（非成员防枚举——成员缺权限点的 403 由 G6 门控组既有覆盖）",
        method: "GET",
        path: "/api/v1/projects/\${__P(PROJECT_ID,NOT_FOUND)}/load-tests",
        status: 404,
        code: 20404,
      }),
    ]),
    threadGroup("G5 校验失败 422", [
      ...registerSetup("EMAIL_G5"),
      sampler({
        name: "T5-1 坏压力模型（并发超上限 201）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/load-tests",
        body: {
          name: "jm-坏模型${TS}",
          target: { method: "GET", url: `${MOCK_BASE}/perf/echo` },
          pressure: { mode: "concurrency", durationSec: 10, maxConcurrency: 201, ramp: [{ atSec: 0, concurrency: 1 }] },
        },
        status: 422,
        code: 20422,
      }),
      sampler({
        name: "T5-2 坏目标 URL（相对路径）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/load-tests",
        body: {
          name: "jm-坏URL${TS}",
          target: { method: "GET", url: "/perf/echo" },
          pressure: { mode: "tps", durationSec: 10, targetTps: 5, rampSec: 0 },
        },
        status: 422,
        code: 20422,
      }),
    ]),
    threadGroup("G6 License 门控（无授权 90001 / 特性缺失 90005）", [
      ...registerSetup("EMAIL_G6"),
      sampler({
        name: "T6-0 admin 移除 License（本组态=社区版）",
        method: "POST",
        path: "/api/v1/auth/login",
        body: ADMIN_LOGIN,
        field: ["$.code", "0"],
        jsr223: { name: "切回 admin 会话", script: "// 本采样器仅重建 admin 会话；下一步 admin 侧删除 License" },
      }),
      sampler({
        name: "T6-1 admin 删除 License",
        method: "DELETE",
        path: "/api/v1/system/license",
        field: ["$.data.edition", "COMMUNITY"],
      }),
      sampler({
        name: "T6-2 用户回会话（重新注册态 cookie 仍有效；License 已撤）",
        method: "POST",
        path: "/api/v1/auth/login",
        body: { email: "${EMAIL_G6}", password: "rabbit-pass-123" },
        field: ["$.code", "0"],
      }),
      sampler({
        name: "T6-3 无 License 建计划 403·90001",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/load-tests",
        body: {
          name: "jm-门控${TS}",
          target: { method: "GET", url: `${MOCK_BASE}/perf/echo` },
          pressure: { mode: "tps", durationSec: 10, targetTps: 5, rampSec: 0 },
        },
        status: 403,
        code: 90001,
      }),
      sampler({
        name: "T6-4 admin 加特性缺失 License（仅 UI_TEST）",
        method: "POST",
        path: "/api/v1/auth/login",
        body: ADMIN_LOGIN,
        field: ["$.code", "0"],
        jsr223: { name: "切 admin", script: "// admin 会话" },
      }),
      sampler({
        name: "T6-5 admin 安装特性缺失 License",
        method: "POST",
        path: "/api/v1/system/license",
        body: { code: "${LICENSE_NO_LOAD}" },
        field: ["$.data.edition", "ENTERPRISE"],
      }),
      sampler({
        name: "T6-6 用户回会话（特性缺失 License 下）",
        method: "POST",
        path: "/api/v1/auth/login",
        body: { email: "${EMAIL_G6}", password: "rabbit-pass-123" },
        field: ["$.code", "0"],
      }),
      sampler({
        name: "T6-7 特性缺失建计划 403·90005",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/load-tests",
        body: {
          name: "jm-门控2${TS}",
          target: { method: "GET", url: `${MOCK_BASE}/perf/echo` },
          pressure: { mode: "tps", durationSec: 10, targetTps: 5, rampSec: 0 },
        },
        status: 403,
        code: 90005,
      }),
      sampler({
        name: "T6-8 admin 恢复全特性 License（供后续组/计划）",
        method: "POST",
        path: "/api/v1/auth/login",
        body: ADMIN_LOGIN,
        field: ["$.code", "0"],
        jsr223: { name: "切 admin", script: "// admin 会话" },
      }),
      sampler({
        name: "T6-9 admin 恢复全特性 License",
        method: "POST",
        path: "/api/v1/system/license",
        body: { code: "${LICENSE}" },
        field: ["$.data.edition", "ENTERPRISE"],
      }),
    ]),
    threadGroup("G9 终态清理（移除 License 还原社区版）", adminCleanup),
  ],
);

// ═══════ UIT-002 UI 测试 ═══════
emit(
  "UIT-002-ui-tests.jmx",
  "UIT-002 UI 测试（元素库/用例 CRUD/执行/门控；四类场景）",
  {
    EMAIL: `jm-uit2-a-${TS}@rabbit.test`,
    EMAIL_G2: `jm-uit2-b-${TS}@rabbit.test`,
    EMAIL_G5: `jm-uit2-c-${TS}@rabbit.test`,
    EMAIL_G6: `jm-uit2-d-${TS}@rabbit.test`,
    LICENSE: LIC_FULL,
    TS,
  },
  [
    threadGroup("G0 admin+License（全特性）", adminWithLicense),
    threadGroup("G1 元素库 CRUD 主链（正常+分页）", [
      ...registerSetup(),
      sampler({
        name: "T1-1 新建元素（testid）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/ui-elements",
        body: { name: "jm-输入框${TS}", locatorType: "testid", locator: "demo-username", description: "演示页输入框" },
        status: 201,
        extract: { var: "EL_ID", path: "$.data.id" },
        jsr223: { name: "EL_ID→props", script: "props.put('EL_ID', vars.get('EL_ID'))" },
      }),
      sampler({
        name: "T1-2 元素列表含新元素（分页信封）",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/ui-elements?page=1&pageSize=50",
        contains: ["$.data.list[?(@.id=='${EL_ID}')].locator", "demo-username"],
        extracts: [
          { var: "EL_TOTAL", path: "$.data.total" },
          { var: "EL_PAGE", path: "$.data.page" },
        ],
        jsr223: {
          name: "分页信封核对",
          script: "if (vars.get('EL_TOTAL') == 'NOT_FOUND' || vars.get('EL_PAGE') != '1') { prev.setSuccessful(false); prev.setResponseMessage('分页信封缺失 total/page') }",
        },
      }),
      sampler({
        name: "T1-3 更新元素（改 locator）",
        method: "PUT",
        path: "/api/v1/projects/${PROJECT_ID}/ui-elements/${EL_ID}",
        body: { locator: "demo-username", description: "改备注" },
        field: ["$.data.description", "改备注"],
      }),
      sampler({
        name: "T1-4 删除元素（悬空语义：用例保留）",
        method: "DELETE",
        path: "/api/v1/projects/${PROJECT_ID}/ui-elements/${EL_ID}",
        field: ["$.data.id", "${EL_ID}"],
      }),
    ]),
    threadGroup("G2 UI 用例 CRUD+执行主链", [
      ...registerSetup("EMAIL_G2"),
      sampler({
        name: "T2-0 建元素（执行链路引用）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/ui-elements",
        body: { name: "jm-提交按钮${TS}", locatorType: "testid", locator: "demo-submit" },
        status: 201,
        extract: { var: "EL2_ID", path: "$.data.id" },
      }),
      sampler({
        name: "T2-1 新建用例（goto/click/assert-text 三步，mock /uit/demo）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/ui-cases",
        body: {
          name: "jm-演示页提交${TS}",
          steps: [
            { op: "goto", url: `${MOCK_BASE}/uit/demo` },
            { op: "click", elementId: "${EL2_ID}" },
            { op: "assert-text", expected: "提交成功", locator: { locatorType: "css", locator: ".demo-result-text" } },
          ],
        },
        status: 201,
        extract: { var: "CASE_ID", path: "$.data.id" },
        contains: ["$.data.id", "-"],
      }),
      sampler({
        name: "T2-2 用例列表含新用例",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/ui-cases?page=1&pageSize=20",
        contains: ["$.data.list[?(@.id=='${CASE_ID}')].name", "jm-演示页提交"],
      }),
      sampler({
        name: "T2-3 触发执行（202 异步）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/ui-cases/${CASE_ID}/run",
        status: 202,
        extract: { var: "UIT_TASK", path: "$.data.taskId" },
        jsr223: { name: "UIT_TASK→props", script: "props.put('UIT_TASK', vars.get('UIT_TASK'))" },
      }),
      sampler({
        name: "T2-4 等 chromium 执行（12s）",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/ui-cases/${CASE_ID}",
        jsr223: { name: "sleep12s", script: "Thread.sleep(12000)" },
        field: ["$.data.id", "${CASE_ID}"],
      }),
      sampler({
        name: "T2-5 任务详情（步骤行三态+帧结构）",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/ui-tasks/${UIT_TASK}",
        contains: ["$.data.items[0].steps", "-"],
      }),
      sampler({
        name: "T2-6 批量执行（≤20 条）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/ui-cases/batch-run",
        body: { caseIds: ["${CASE_ID}"] },
        status: 202,
        extract: { var: "UIT_BATCH_TASK", path: "$.data.taskId" },
      }),
      sampler({
        name: "T2-7 批量超上限 422·90083（21 条）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/ui-cases/batch-run",
        body: { caseIds: Array.from({ length: 21 }, () => "${CASE_ID}") },
        status: 422,
        code: 20422, // zod batchSchema max(20) 先于服务层（40083 保留服务层兜底）
      }),
    ]),
    threadGroup("G3 无会话 401（无 Cookie）", [
      sampler({
        name: "T3-1 未登录建用例",
        method: "POST",
        path: "/api/v1/projects/\${__P(PROJECT_ID,NOT_FOUND)}/ui-cases",
        body: { name: "x", steps: [{ op: "wait", ms: 1 }] },
        status: 401,
        code: 10001,
      }),
    ], false),
    threadGroup("G4 普通成员越权 403", [
      sampler({
        name: "T4-0 注册普通用户",
        method: "POST",
        path: "/api/v1/auth/register",
        body: { email: "jm-uit2-member${TS}@rabbit.test", password: "rabbit-pass-123" },
        status: 201,
        duration: 8000,
      }),
      sampler({
        name: "T4-1 普通用户跨项目读他人用例列表 404·20404（非成员防枚举——成员缺权限点的 403 由 G6 门控组既有覆盖）",
        method: "GET",
        path: "/api/v1/projects/\${__P(PROJECT_ID,NOT_FOUND)}/ui-cases",
        status: 404,
        code: 20404,
      }),
    ]),
    threadGroup("G5 校验失败 422", [
      ...registerSetup("EMAIL_G5"),
      sampler({
        name: "T5-1 坏步骤（交互指令缺元素引用与内联定位器）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/ui-cases",
        body: { name: "jm-坏步骤${TS}", steps: [{ op: "goto", url: `${MOCK_BASE}/uit/demo` }, { op: "click" }] },
        status: 422,
        code: 20422,
      }),
      sampler({
        name: "T5-2 坏定位方式（bogus）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/ui-elements",
        body: { name: "jm-坏元素${TS}", locatorType: "bogus", locator: "#x" },
        status: 422,
        code: 20422,
      }),
    ]),
    threadGroup("G6 License 门控（无授权 90001）", [
      ...registerSetup("EMAIL_G6"),
      sampler({
        name: "T6-0 admin 移除 License",
        method: "POST",
        path: "/api/v1/auth/login",
        body: ADMIN_LOGIN,
        field: ["$.code", "0"],
        jsr223: { name: "切 admin", script: "// admin 会话" },
      }),
      sampler({
        name: "T6-1 admin 删除 License",
        method: "DELETE",
        path: "/api/v1/system/license",
        field: ["$.data.edition", "COMMUNITY"],
      }),
      sampler({
        name: "T6-2 用户回会话",
        method: "POST",
        path: "/api/v1/auth/login",
        body: { email: "${EMAIL_G6}", password: "rabbit-pass-123" },
        field: ["$.code", "0"],
      }),
      sampler({
        name: "T6-3 无 License 建用例 403·90001",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/ui-cases",
        body: { name: "jm-门控${TS}", steps: [{ op: "wait", ms: 1 }] },
        status: 403,
        code: 90001,
      }),
      sampler({
        name: "T6-4 admin 恢复全特性 License",
        method: "POST",
        path: "/api/v1/auth/login",
        body: ADMIN_LOGIN,
        field: ["$.code", "0"],
        jsr223: { name: "切 admin", script: "// admin 会话" },
      }),
      sampler({
        name: "T6-5 admin 恢复 License",
        method: "POST",
        path: "/api/v1/system/license",
        body: { code: "${LICENSE}" },
        field: ["$.data.edition", "ENTERPRISE"],
      }),
    ]),
    threadGroup("G9 终态清理（移除 License 还原社区版）", adminCleanup),
  ],
);

// ═══════ 写文件 ═══════
mkdirSync(OUT, { recursive: true });
let written = 0;
for (const [name, content] of files) {
  const fp = path.join(OUT, name);
  if (existsSync(fp) && !FORCE) {
    console.log(`[gen-jmx-s11] 跳过已存在 ${name}（--force 覆盖）`);
    continue;
  }
  writeFileSync(fp, content);
  written++;
  console.log(`[gen-jmx-s11] 写出 ${name}（${content.length} 字符）`);
}
console.log(`[gen-jmx-s11] 完成：${written}/${files.size} 份`);
