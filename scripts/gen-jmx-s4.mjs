#!/usr/bin/env node
/**
 * Sprint 4 JMeter 用例生成器：从声明式定义生成 tests/api/{PLAN-002..005, CASE-007/008, DASH-002}-*.jmx。
 * 规范 rules/testing §2：四类场景（正常/401·403·404/422/分页信封）×四项断言。
 * 复用 gen-jmx-s3.mjs 的采样器/轮询/线程组结构（S2 勘误吸收同款）。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

/** 采样器四项断言（HTTP/code/关键字段/耗时）；status>=400 自动 assume_success。 */
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
  if (!d.binary) {
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
    if (d.contains) {
      assertions.push(`
          <JSONPathAssertion guiclass="JSONPathAssertionGui" testclass="JSONPathAssertion" testname="contains ${esc(d.contains[1])}">
            <stringProp name="JSON_PATH">${esc(d.contains[0])}</stringProp>
            <stringProp name="EXPECTED_VALUE">${esc(d.contains[1])}</stringProp>
            <boolProp name="JSONVALIDATION">false</boolProp>
          </JSONPathAssertion>
          <hashTree/>`);
    }
  }
  assertions.push(`
          <DurationAssertion guiclass="DurationAssertionGui" testclass="DurationAssertion" testname="&lt;${d.duration ?? 3000}ms">
            <stringProp name="DurationAssertion.duration">${d.duration ?? 3000}</stringProp>
          </DurationAssertion>
          <hashTree/>`);
  const extractList = d.extracts ?? (d.extract ? [d.extract] : []);
  const extract = extractList
    .map(
      (ex) => `
          <JSONPostProcessor guiclass="JSONPostProcessorGui" testclass="JSONPostProcessor" testname="提取 ${ex.var}">
            <stringProp name="JSONPostProcessor.referenceNames">${ex.var}</stringProp>
            <stringProp name="JSONPostProcessor.jsonPathExprs">${esc(ex.path)}</stringProp>
            <stringProp name="JSONPostProcessor.match_numbers">1</stringProp>
            <stringProp name="JSONPostProcessor.defaultValues">NOT_FOUND</stringProp>
          </JSONPostProcessor>
          <hashTree/>`,
    )
    .join("");
  const bodyProp =
    d.body !== undefined
      ? `
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments">
            <collectionProp name="Arguments.arguments">
              <elementProp name="" elementType="HTTPArgument">
                <boolProp name="HTTPArgument.always_encode">false</boolProp>
                <stringProp name="Argument.value">${esc(typeof d.body === "string" ? d.body : JSON.stringify(d.body))}</stringProp>
                <stringProp name="Argument.metadata">=</stringProp>
              </elementProp>
            </collectionProp>
          </elementProp>`
      : "";
  return `
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${esc(d.name)}">${bodyProp}
          <stringProp name="HTTPSampler.domain">\${__P(HOST,localhost)}</stringProp>
          <stringProp name="HTTPSampler.port">\${__P(PORT,3100)}</stringProp>
          <stringProp name="HTTPSampler.path">${esc(d.path)}</stringProp>
          <stringProp name="HTTPSampler.method">${d.method}</stringProp>
          <boolProp name="HTTPSampler.use_keepalive">true</boolProp>
        </HTTPSamplerProxy>
        <hashTree>${extract}${assertions.join("")}
        </hashTree>`;
}

/** WhileController 轮询块（终态判断 + Counter + 500ms）。 */
function whilePoll(taskIdVar, prefix = "") {
  const i = `LOOP${prefix}_I`;
  const st = `STATUS${prefix}`;
  return `
        <WhileController guiclass="WhileControllerGui" testclass="WhileController" testname="轮询至终态（上限 20 次）">
          <stringProp name="WhileController.condition">\${__jexl3(\${${i}} &lt; 20 &amp;&amp; &quot;\${${st}}&quot; != &quot;SUCCESS&quot; &amp;&amp; &quot;\${${st}}&quot; != &quot;FAILED&quot; &amp;&amp; &quot;\${${st}}&quot; != &quot;STOPPED&quot;)}</stringProp>
        </WhileController>
        <hashTree>${sampler({
          name: "轮询任务状态",
          method: "GET",
          path: `/api/v1/projects/\${PROJECT_ID}/reports/\${${taskIdVar}}`,
          duration: 5000,
          extract: { var: st, path: "$.data.status" },
        })}
          <ConstantTimer guiclass="ConstantTimerGui" testclass="ConstantTimer" testname="500ms">
            <stringProp name="ConstantTimer.delay">500</stringProp>
          </ConstantTimer>
          <hashTree/>
          <CounterConfig guiclass="CounterConfigGui" testclass="CounterConfig" testname="计数 ${i}">
            <stringProp name="CounterConfig.start">1</stringProp>
            <stringProp name="CounterConfig.end">9999999</stringProp>
            <stringProp name="CounterConfig.incr">1</stringProp>
            <stringProp name="CounterConfig.name">${i}</stringProp>
            <stringProp name="CounterConfig.format"></stringProp>
            <boolProp name="CounterConfig.perUser">true</boolProp>
            <boolProp name="CounterConfig.resetOnIteration">false</boolProp>
          </CounterConfig>
          <hashTree/>
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

// ═══════ 通用片段 ═══════
const TS = () => "${TS}";
const MOCK = () => "${__P(MOCK_URL,http://127.0.0.1:4000/hello)}";
const FAKE_PID = "00000000-0000-0000-0000-000000000009";

const registerSetup = () => [
  {
    name: "T0 注册并取会话+项目",
    method: "POST",
    path: "/api/v1/auth/register",
    body: { email: "${EMAIL}", password: "rabbit-pass-123" },
    status: 201,
    contains: ["$.data.projectId", "-"],
    extract: { var: "PROJECT_ID", path: "$.data.projectId" },
    duration: 8000,
  },
  {
    name: "T0.0 提取 USER_ID",
    method: "GET",
    path: "/api/v1/personal/me",
    extract: { var: "USER_ID", path: "$.data.userId" },
  },
];
const caseModule = () => [
  {
    name: "T0.1 取默认模块（scene=case）",
    method: "GET",
    path: "/api/v1/projects/${PROJECT_ID}/modules?scene=case",
    contains: ["$.data.items[0].id", "-"],
    extract: { var: "MODULE_ID", path: "$.data.items[0].id" },
  },
];
const unauthGroup = (s) => threadGroup("未登录（无 Cookie）", [sampler(s)], false);
const apiModule = () => [
  {
    name: "T0.x 取默认模块（scene=api）",
    method: "GET",
    path: "/api/v1/projects/${PROJECT_ID}/modules?scene=api",
    contains: ["$.data.items[0].id", "-"],
    extract: { var: "MODULE_API", path: "$.data.items[0].id" },
  },
];

/** 功能用例创建（CASE-001 契约）。 */
const createCase = (name) => ({
  name: `T0.2 建功能用例「${name}」`,
  method: "POST",
  path: "/api/v1/projects/${PROJECT_ID}/cases",
  body: {
    name: `jm-s4-${name}-${TS()}`,
    precondition: "前置",
    steps: [
      { desc: "步骤一", expect: "预期一" },
      { desc: "步骤二", expect: "预期二" },
    ],
    level: "P1",
    tags: [],
    moduleId: "${MODULE_ID}",
    fields: {},
  },
  status: 201,
  extract: { var: "CASE_ID", path: "$.data.id" },
});
/** 计划创建（PLAN-001 契约）。 */
const createPlan = (name) => ({
  name: `T0.3 建计划「${name}」`,
  method: "POST",
  path: "/api/v1/projects/${PROJECT_ID}/plans",
  body: {
    name: `jm-s4-${name}-${TS()}`,
    settings: { allowDuplicate: false, autoUpdateStatus: false, threshold: 80 },
  },
  status: 201,
  extract: { var: "PLAN_ID", path: "$.data.id" },
});

// ═══════ PLAN-002 测试规划与测试点 ═══════
const plan002 = plan(
  "PLAN-002 测试规划与测试点（树/继承/挂载/移动）",
  {
    EMAIL: "jm-s4p2-${__time(yyyyMMddHHmmss)}-${__threadNum}@rabbit.test",
    TS: "${__time(yyyyMMddHHmmss)}",
  },
  [
    threadGroup("测试点主链路", [
      ...registerSetup().map(sampler),
      ...caseModule().map(sampler),
      ...[createCase("挂点源")].map(sampler),
      ...[createPlan("规划")].map(sampler),
      sampler({
        name: "T1-1 建父点",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/plans/${PLAN_ID}/points",
        body: { name: "支付域", inheritConfig: true },
        status: 201,
        extract: { var: "PARENT_PT", path: "$.data.id" },
      }),
      sampler({
        name: "T1-2 建子点（显式配置：串行+失败停止）",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/points`,
        body: {
          name: "扫码支付",
          parentId: "${PARENT_PT}",
          inheritConfig: false,
          config: { serial: true, stopOnFail: true },
        },
        status: 201,
        extract: { var: "CHILD_PT", path: "$.data.id" },
      }),
      sampler({
        name: "T1-3 点树回读（含计数与未分组）",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/points`,
        field: ["$.data.points[0].name", "支付域"],
        contains: ["$.data.points[0].children[0].name", "扫码支付"],
      }),
      sampler({
        name: "T1-4 关联用例挂子点",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/cases`,
        body: { caseIds: ["${CASE_ID}"], pointId: "${CHILD_PT}" },
      }),
      sampler({
        name: "T1-4b 计划详情提取 REF_ID（fn 行 refId）",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}`,
        extract: { var: "REF_ID", path: "$.data.cases[0].refId" },
        contains: ["$.data.cases[0].refType", "functional_case"],
      }),
      sampler({
        name: "T1-5 挂点后计数（functional_case=1）",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/points`,
        field: ["$.data.points[0].children[0].counts.functional_case", "1"],
      }),
      sampler({
        name: "T1-6 点间移动到未分组",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/cases/move`,
        body: { refIds: ["${REF_ID}"], pointId: null },
      }),
      sampler({
        name: "T1-7 计划详情透出 pointId=null",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}`,
        field: ["$.data.cases[0].pointId", "null"],
      }),
      sampler({
        name: "T1-8 移回子点",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/cases/move`,
        body: { refIds: ["${REF_ID}"], pointId: "${CHILD_PT}" },
      }),
      sampler({
        name: "T2-1 随机点 404(30454)",
        method: "PUT",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/points/11111111-2222-4333-8444-555555555555`,
        body: { name: "x" },
        status: 404,
        code: 30454,
      }),
      sampler({
        name: "T3-1 parent 指向自身 422(30456 POINT_CYCLE)",
        method: "PUT",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/points/\${CHILD_PT}`,
        body: { parentId: "${CHILD_PT}" },
        status: 422,
        code: 30456,
      }),
      sampler({
        name: "T3-2 删除非空点 422(30455 POINT_NOT_EMPTY)",
        method: "DELETE",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/points/\${CHILD_PT}`,
        status: 422,
        code: 30455,
      }),
      sampler({
        name: "T3-3 关联坏 pointId 404(30454)",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/cases`,
        body: { caseIds: ["${CASE_ID}"], pointId: "11111111-2222-4333-8444-555555555555" },
        status: 404,
        code: 30454,
      }),
      sampler({
        name: "T4-1 空名建点 422(20422)",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/points`,
        body: { name: "" },
        status: 422,
        code: 20422,
      }),
    ]),
    unauthGroup({
      name: "T2-2 未登录读点树 401(10001)",
      method: "GET",
      path: `/api/v1/projects/${FAKE_PID}/plans/11111111-2222-4333-8444-555555555555/points`,
      status: 401,
      code: 10001,
    }),
  ],
);

// ═══════ PLAN-003 计划执行（引擎调度） ═══════
const apiSpec = (url, asserts = []) => ({
  spec: {
    method: "GET",
    url,
    headers: [],
    query: [],
    body: { kind: "none" },
    auth: { kind: "none" },
  },
  asserts,
  pre: [],
  post: [],
  extracts: [],
});
const customStep = (name, url, asserts = []) => ({
  uid: `u-${name}`,
  stepType: "custom",
  name,
  enabled: true,
  config: { bundle: apiSpec(url, asserts) },
  children: [],
});

const plan003 = plan(
  "PLAN-003 计划执行（契约 v4 plan 命令/回写/自动更新）",
  {
    EMAIL: "jm-s4p3-${__time(yyyyMMddHHmmss)}-${__threadNum}@rabbit.test",
    TS: "${__time(yyyyMMddHHmmss)}",
  },
  [
    threadGroup("计划引擎执行主链路", [
      ...registerSetup().map(sampler),
      ...caseModule().map(sampler),
      ...apiModule().map(sampler),
      // 接口域准备：api 定义 + 2 用例（一成功一必败）+ 场景
      sampler({
        name: "T0.2 建接口定义",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/apis",
        body: {
          moduleId: "\${MODULE_API}",
          name: `jm-s4-计划执行-${TS()}`,
          request: apiSpec(MOCK()),
        },
        status: 201,
        extract: { var: "API_ID", path: "$.data.id" },
      }),
      sampler({
        name: "T0.3 建接口用例（正向）",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/apis/\${API_ID}/cases`,
        body: {
          name: "计划内-正向",
          level: "P1",
          status: "UNDERWAY",
          tags: [],
          request: apiSpec(MOCK()),
        },
        status: 201,
        extract: { var: "ACASE_OK", path: "$.data.id" },
      }),
      sampler({
        name: "T0.4 建接口用例（必败：断言 eq 500）",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/apis/\${API_ID}/cases`,
        body: {
          name: "计划内-必败",
          level: "P2",
          status: "UNDERWAY",
          tags: [],
          request: apiSpec(MOCK(), [{ kind: "status_code", path: "", op: "eq", expected: "500" }]),
        },
        status: 201,
        extract: { var: "ACASE_BAD", path: "$.data.id" },
      }),
      sampler({
        name: "T0.5 建场景并保存步骤",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios",
        body: { name: `jm-s4-计划场景-${TS()}`, moduleId: "\${MODULE_ID}" },
        status: 201,
        extract: { var: "SC_ID", path: "$.data.id" },
      }),
      sampler({
        name: "T0.6 场景存步骤",
        method: "PUT",
        path: `/api/v1/projects/\${PROJECT_ID}/scenarios/\${SC_ID}/steps`,
        body: { version: 1, steps: [customStep("场景请求", MOCK())] },
      }),
      ...[createPlan("执行")].map(sampler),
      sampler({
        name: "T1-1 关联 2 接口用例 + 1 场景（不挂点）",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/cases`,
        body: { apiCaseIds: ["${ACASE_OK}", "${ACASE_BAD}"], scenarioIds: ["${SC_ID}"] },
      }),
      sampler({
        name: "T1-2 执行计划（串行+失败停止）",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/execute`,
        body: { mode: "serial", stopOnFail: true },
        status: 201,
        field: ["$.data.itemCount", "3"],
        extract: { var: "TASK_ID", path: "$.data.taskId" },
        duration: 8000,
      }),
      whilePoll("TASK_ID"),
      sampler({
        name: "T1-3 执行历史 type=plan 落一条",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/executions`,
        field: ["$.data.total", "1"],
        contains: ["$.data.items[0].taskId", "${TASK_ID}"],
      }),
      sampler({
        name: "T1-4 计划详情回写（必败→FAIL；停止→SKIPPED）",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}`,
        contains: ["$.data.cases", "计划内-必败"],
        duration: 5000,
      }),
      sampler({
        name: "T1-5 报告 type=plan 可读",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/reports/\${TASK_ID}`,
        field: ["$.data.type", "plan"],
        contains: ["$.data.status", "FAILED"],
      }),
      sampler({
        name: "T1-5b 详情提取 REF_OK（按 caseId 过滤——uuid 序随机）",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}`,
        extract: { var: "REF_OK", path: "$.data.cases[?(@.caseId=='${ACASE_OK}')].refId" },
        contains: ["$.data.cases", "api_case"],
      }),
      sampler({
        name: "T1-6 单条执行（run 正向用例）",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/cases/\${REF_OK}/run`,
        body: {},
        status: 201,
        extract: { var: "TASK2_ID", path: "$.data.taskId" },
        duration: 8000,
      }),
      whilePoll("TASK2_ID", "2"),
      sampler({
        name: "T1-7 单条报告 SUCCESS",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/reports/\${TASK2_ID}`,
        contains: ["$.data.status", "SUCCESS"],
      }),
      sampler({
        name: "T0.7 建空计划（无可执行项）",
        method: "POST",
        path: "/api/v1/projects/\${PROJECT_ID}/plans",
        body: { name: `jm-s4-空计划-\${TS}` },
        status: 201,
        extract: { var: "EMPTY_PLAN", path: "$.data.id" },
      }),
      sampler({
        name: "T3-1 空计划执行 422(50012 PLAN_NO_EXECUTABLE)",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${EMPTY_PLAN}/execute`,
        body: {},
        status: 422,
        code: 50012,
      }),
      sampler({
        name: "T3-2 坏点范围执行 404(30454)",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/execute`,
        body: { pointId: "11111111-2222-4333-8444-555555555555" },
        status: 404,
        code: 30454,
      }),
      // 自动更新状态二态：开→PASS 的 api_case 关联功能用例自动 PASS
      ...[createCase("自动更新")].map(sampler),
      sampler({
        name: "T4-1 CASE-006 关联功能用例↔正向接口用例",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/cases/\${CASE_ID}/api-refs`,
        body: { refType: "api_case", refIds: ["${ACASE_OK}"] },
        status: 201,
      }),
      sampler({
        name: "T4-2 开启自动更新状态",
        method: "PUT",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}`,
        body: { settings: { allowDuplicate: false, autoUpdateStatus: true, threshold: 80 } },
      }),
      sampler({
        name: "T4-3 关联功能用例入计划",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/cases`,
        body: { caseIds: ["${CASE_ID}"] },
      }),
      sampler({
        name: "T4-4 详情提取功能用例 REF_FN",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}`,
        extract: { var: "REF_FN", path: "$.data.cases[?(@.caseId=='${CASE_ID}')].refId" },
        contains: ["$.data.cases", "functional_case"],
      }),
      sampler({
        name: "T4-5 单跑正向接口用例（触发自动更新）",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/cases/\${REF_OK}/run`,
        body: {},
        status: 201,
        extract: { var: "TASK3_ID", path: "$.data.taskId" },
        duration: 8000,
      }),
      whilePoll("TASK3_ID", "3"),
      sampler({
        name: "T4-6 自动更新生效（功能用例 NOT_RUN→PASS）",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}`,
        contains: ["$.data.cases[?(@.caseId=='${CASE_ID}')].status", "PASS"],
        duration: 5000,
      }),
    ]),
    unauthGroup({
      name: "T2-1 未登录执行计划 401(10001)",
      method: "POST",
      path: `/api/v1/projects/${FAKE_PID}/plans/11111111-2222-4333-8444-555555555555/execute`,
      body: {},
      status: 401,
      code: 10001,
    }),
  ],
);

// ═══════ PLAN-004 计划分组 ═══════
const plan004 = plan(
  "PLAN-004 计划分组（组视图/移入/级联归档/组报告）",
  {
    EMAIL: "jm-s4p4-${__time(yyyyMMddHHmmss)}-${__threadNum}@rabbit.test",
    TS: "${__time(yyyyMMddHHmmss)}",
  },
  [
    threadGroup("计划组主链路", [
      ...registerSetup().map(sampler),
      sampler({
        name: "T1-1 建组",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/plan-groups",
        body: { name: `jm-s4-组-${TS()}`, description: "回归组" },
        status: 201,
        extract: { var: "GROUP_ID", path: "$.data.id" },
      }),
      ...[createPlan("组员A")].map(sampler),
      sampler({
        name: "T1-2 移入 A",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/move-group`,
        body: { groupId: "${GROUP_ID}" },
      }),
      ...[createPlan("组员B")].map(sampler),
      sampler({
        name: "T1-3 移入 B",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/move-group`,
        body: { groupId: "${GROUP_ID}" },
      }),
      sampler({
        name: "T1-4 组列表聚合（memberCount=2）",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/plan-groups",
        field: ["$.data.groups[0].aggregate.memberCount", "2"],
        contains: ["$.data.groups[0].members[0].name", "jm-s4-"],
      }),
      sampler({
        name: "T1-5 组报告聚合（懒创建）",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/plan-groups/\${GROUP_ID}/report`,
        field: ["$.data.aggregate.memberCount", "2"],
        contains: ["$.data.reportId", "-"],
        extract: { var: "GREPORT_ID", path: "$.data.reportId" },
      }),
      sampler({
        name: "T1-6 组总结保存",
        method: "PUT",
        path: `/api/v1/projects/\${PROJECT_ID}/plan-groups/\${GROUP_ID}/report/summary`,
        body: { summary: "jm-s4-组总结：冒烟未达阈，回归后重跑" },
      }),
      sampler({
        name: "T1-7 组报告回读总结",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/plan-groups/\${GROUP_ID}/report`,
        contains: ["$.data.summary", "jm-s4-组总结"],
      }),
      sampler({
        name: "T1-8 组归档（级联成员）",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plan-groups/\${GROUP_ID}/archive`,
        body: {},
      }),
      sampler({
        name: "T1-9 成员只读（PUT 422/10008）",
        method: "PUT",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}`,
        body: { name: "should-fail" },
        status: 422,
        code: 10008,
      }),
      sampler({
        name: "T1-10 组恢复",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plan-groups/\${GROUP_ID}/unarchive`,
        body: {},
      }),
      sampler({
        name: "T2-1 随机组 404(30464)",
        method: "PUT",
        path: "/api/v1/projects/${PROJECT_ID}/plan-groups/11111111-2222-4333-8444-555555555555",
        body: { name: "x" },
        status: 404,
        code: 30464,
      }),
      sampler({
        name: "T3-1 删除非空组 422(30465)",
        method: "DELETE",
        path: `/api/v1/projects/\${PROJECT_ID}/plan-groups/\${GROUP_ID}`,
        status: 422,
        code: 30465,
      }),
      sampler({
        name: "T3-2 组移入组（嵌套）422(30466)",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${GROUP_ID}/move-group`,
        body: { groupId: "${GROUP_ID}" },
        status: 422,
        code: 30466,
      }),
      sampler({
        name: "T3-3 空名建组 422(20422)",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/plan-groups",
        body: { name: "" },
        status: 422,
        code: 20422,
      }),
      sampler({
        name: "T4-1 批量归档（混选成员）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/plans/batch-archive",
        body: { ids: ["${PLAN_ID}"], archived: true },
      }),
      sampler({
        name: "T4-2 批量恢复",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/plans/batch-archive",
        body: { ids: ["${PLAN_ID}"], archived: false },
      }),
    ]),
    unauthGroup({
      name: "T2-2 未登录读组 401(10001)",
      method: "GET",
      path: `/api/v1/projects/${FAKE_PID}/plan-groups`,
      status: 401,
      code: 10001,
    }),
  ],
);

// ═══════ PLAN-005 计划报告导出 ═══════
const plan005 = plan(
  "PLAN-005 计划报告（视图/一键总结/分享/CSV）",
  {
    EMAIL: "jm-s4p5-${__time(yyyyMMddHHmmss)}-${__threadNum}@rabbit.test",
    TS: "${__time(yyyyMMddHHmmss)}",
  },
  [
    threadGroup("报告导出主链路", [
      ...registerSetup().map(sampler),
      ...caseModule().map(sampler),
      ...[createCase("报告源")].map(sampler),
      ...[createPlan("报告")].map(sampler),
      sampler({
        name: "T1-1 关联用例",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/cases`,
        body: { caseIds: ["${CASE_ID}"] },
      }),
      sampler({
        name: "T1-1b 详情提取 REF_ID",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}`,
        extract: { var: "REF_ID", path: "$.data.cases[0].refId" },
        contains: ["$.data.cases[0].refType", "functional_case"],
      }),
      sampler({
        name: "T1-2 标记执行 PASS",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/cases/\${REF_ID}/exec`,
        body: { status: "PASS", actualResult: "通过", comment: "" },
      }),
      sampler({
        name: "T1-3 报告视图（点分组+概览）",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/report/view`,
        field: ["$.data.overview.total", "1"],
        contains: ["$.data.points[0].name", "未分组"],
        extract: { var: "VIEW_REPORT_ID", path: "$.data.reportId" },
      }),
      sampler({
        name: "T1-4 一键总结草稿（含达标口径）",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/report/draft`,
        body: {},
        contains: ["$.data.draft", "执行总结"],
      }),
      sampler({
        name: "T1-5 保存总结",
        method: "PUT",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/report/summary`,
        body: { summary: "jm-s4-保存的总结：一轮全过" },
      }),
      sampler({
        name: "T1-6 视图回读总结",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/report/view`,
        contains: ["$.data.summary", "jm-s4-保存的总结"],
      }),
      sampler({
        name: "T1-7 建分享（1 天）",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/report/shares`,
        body: { expireHours: 24 },
        status: 201,
        extract: { var: "SHARE_TOKEN", path: "$.data.token" },
      }),
      sampler({
        name: "T1-8 免登录分享读（无 Cookie 组外验证见 T2-1）",
        method: "GET",
        path: `/api/v1/share/plan/\${SHARE_TOKEN}`,
        contains: ["$.data.planName", "jm-s4-"],
      }),
      sampler({
        name: "T1-9 分享列表 total=1",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/report/shares`,
        field: ["$.data.total", "1"],
      }),
      sampler({
        name: "T1-10 吊销分享",
        method: "DELETE",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/report/shares/\${SHARE_TOKEN}`,
      }),
      sampler({
        name: "T1-11 吊销后免登录读 404(60414)",
        method: "GET",
        path: `/api/v1/share/plan/\${SHARE_TOKEN}`,
        status: 404,
        code: 60414,
      }),
      sampler({
        name: "T1-12 CSV 导出（attachment 二进制流）",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/report/export`,
        binary: true,
        duration: 5000,
      }),
      sampler({
        name: "T3-1 坏 expireHours 422(20422)",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/report/shares`,
        body: { expireHours: 5 },
        status: 422,
        code: 20422,
      }),
      sampler({
        name: "T2-1 随机计划报告 404(30434)",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/plans/11111111-2222-4333-8444-555555555555/report/view",
        status: 404,
        code: 30434,
      }),
    ]),
    unauthGroup({
      name: "T2-2 未登录读报告视图 401(10001)",
      method: "GET",
      path: `/api/v1/projects/${FAKE_PID}/plans/11111111-2222-4333-8444-555555555555/report/view`,
      status: 401,
      code: 10001,
    }),
  ],
);

// ═══════ CASE-007 脑图批量保存 ═══════
const plan007 = plan(
  "CASE-007 脑图批量保存（模块批/用例批/冲突）",
  {
    EMAIL: "jm-s4c7-${__time(yyyyMMddHHmmss)}-${__threadNum}@rabbit.test",
    TS: "${__time(yyyyMMddHHmmss)}",
  },
  [
    threadGroup("脑图保存主链路", [
      ...registerSetup().map(sampler),
      ...caseModule().map(sampler),
      sampler({
        name: "T1-1 脑图批量保存（建模块+建用例）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/cases/mindmap-save",
        body: {
          modules: {
            created: [{ tmpId: "tmp-mod-1", name: `jm-s4-脑图模块-${TS()}`, parentId: null }],
            renamed: [],
            deleted: [],
          },
          cases: {
            created: [
              {
                tmpId: "tmp-case-1",
                name: `jm-s4-脑图用例-${TS()}`,
                moduleId: "tmp-mod-1",
                level: "P1",
                precondition: "前置",
                steps: [
                  { desc: "脑图步骤一", expect: "预期一" },
                  { desc: "脑图步骤二", expect: "预期二" },
                ],
              },
            ],
            updated: [],
            deleted: [],
          },
        },
        status: 201,
        field: ["$.data.saved.casesCreated", "1"],
        contains: ["$.data.idMap.tmp-mod-1", "-"],
        extract: { var: "NEW_MODULE", path: "$.data.idMap['tmp-mod-1']" },
      }),
      sampler({
        name: "T1-2 tmpId 映射有效（模块列表含新模块）",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/modules?scene=case",
        contains: ["$.data.items[?(@.id=='${NEW_MODULE}')].name", "jm-s4-脑图模块"],
      }),
      sampler({
        name: "T1-3 列表可见新用例",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/cases?keyword=jm-s4-${"脑图用例"}&page=1&pageSize=10`,
        contains: ["$.data.items[0].name", "jm-s4-脑图用例"],
        extract: { var: "NEW_CASE", path: "$.data.items[0].id" },
      }),
      sampler({
        name: "T1-4 更新（改名+改步骤）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/cases/mindmap-save",
        body: {
          cases: {
            updated: [
              {
                id: "${NEW_CASE}",
                version: 1,
                name: `jm-s4-脑图用例-改-${TS()}`,
                steps: [{ desc: "改后步骤", expect: "改后预期" }],
              },
            ],
          },
        },
        status: 201,
        field: ["$.data.saved.casesUpdated", "1"],
        contains: ["$.data.conflicts", "[]"],
      }),
      sampler({
        name: "T1-5 变更历史分区（partitions.steps）",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/cases/\${NEW_CASE}/changes`,
        contains: ["$.data.items[0].diff", "partitions"],
      }),
      sampler({
        name: "T2-1 旧版本更新 → 冲突软收集（conflicts=1）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/cases/mindmap-save",
        body: {
          cases: { updated: [{ id: "${NEW_CASE}", version: 1, name: "stale-edit" }] },
        },
        status: 201,
        contains: ["$.data.conflicts", "版本冲突"],
      }),
      sampler({
        name: "T3-1 空名模块 422(20422)",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/cases/mindmap-save",
        body: { modules: { created: [{ tmpId: "t", name: "", parentId: null }] } },
        status: 422,
        code: 20422,
      }),
      sampler({
        name: "T1-6 软删用例（入回收站）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/cases/mindmap-save",
        body: { cases: { deleted: ["${NEW_CASE}"] } },
        status: 201,
        field: ["$.data.saved.casesDeleted", "1"],
      }),
      sampler({
        name: "T4-1 回收站可见",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/cases?recycled=true&keyword=jm-s4-${"脑图用例"}&page=1&pageSize=10`,
        contains: ["$.data.items[0].name", "脑图用例"],
      }),
    ]),
    unauthGroup({
      name: "T2-2 未登录保存脑图 401(10001)",
      method: "POST",
      path: `/api/v1/projects/${FAKE_PID}/cases/mindmap-save`,
      body: {},
      status: 401,
      code: 10001,
    }),
  ],
);

// ═══════ CASE-008 依赖与历史 ═══════
const plan008 = plan(
  "CASE-008 依赖（环检测/自引用/执行联动）",
  {
    EMAIL: "jm-s4c8-${__time(yyyyMMddHHmmss)}-${__threadNum}@rabbit.test",
    TS: "${__time(yyyyMMddHHmmss)}",
  },
  [
    threadGroup("依赖主链路", [
      ...registerSetup().map(sampler),
      ...caseModule().map(sampler),
      ...[createCase("依赖A")].map(sampler),
      sampler({
        name: "T0.4 建用例 B",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/cases",
        body: {
          name: `jm-s4-依赖B-${TS()}`,
          precondition: "",
          steps: [{ desc: "B 步骤", expect: "B 预期" }],
          level: "P2",
          tags: [],
          moduleId: "${MODULE_ID}",
          fields: {},
        },
        status: 201,
        extract: { var: "CASE_B", path: "$.data.id" },
      }),
      sampler({
        name: "T1-1 A→B 依赖建立",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/cases/\${CASE_B}/dependencies`,
        body: { preCaseId: "${CASE_ID}", postCaseId: "${CASE_B}" },
        status: 201,
        extract: { var: "DEP_ID", path: "$.data.id" },
      }),
      sampler({
        name: "T1-2 依赖列表（B 前置含 A）",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/cases/\${CASE_B}/dependencies`,
        contains: ["$.data.pre", "jm-s4-依赖A"],
      }),
      sampler({
        name: "T1-3 重复依赖 422(20422)",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/cases/\${CASE_B}/dependencies`,
        body: { preCaseId: "${CASE_ID}", postCaseId: "${CASE_B}" },
        status: 422,
        code: 20422,
      }),
      sampler({
        name: "T1-4 反向依赖成环 422(30484 DEPENDENCY_CYCLE)",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/cases/\${CASE_ID}/dependencies`,
        body: { preCaseId: "${CASE_B}", postCaseId: "${CASE_ID}" },
        status: 422,
        code: 30484,
      }),
      sampler({
        name: "T1-5 自依赖 422(30485)",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/cases/\${CASE_ID}/dependencies`,
        body: { preCaseId: "${CASE_ID}", postCaseId: "${CASE_ID}" },
        status: 422,
        code: 30485,
      }),
      // 执行联动：计划内 A FAIL → 标记 B 返回 blockedBy
      ...[createPlan("依赖联动")].map(sampler),
      sampler({
        name: "T2-1 A、B 入计划",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/cases`,
        body: { caseIds: ["${CASE_ID}", "${CASE_B}"] },
      }),
      sampler({
        name: "T2-1b 详情提取 REF_A/REF_B（按 caseId 过滤）",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}`,
        extracts: [
          { var: "REF_A", path: "$.data.cases[?(@.caseId=='${CASE_ID}')].refId" },
          { var: "REF_B", path: "$.data.cases[?(@.caseId=='${CASE_B}')].refId" },
        ],
      }),
      sampler({
        name: "T2-2 标记 A FAIL",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/cases/\${REF_A}/exec`,
        body: { status: "FAIL", actualResult: "A 失败", comment: "" },
      }),
      sampler({
        name: "T2-3 标记 B → 响应含 blockedBy 提示",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/cases/\${REF_B}/exec`,
        body: { status: "BLOCKED", actualResult: "前置未过", comment: "" },
        contains: ["$.data.blockedBy", "caseId"],
      }),
      sampler({
        name: "T2-4 B 留痕（result.blockedBy）",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}`,
        contains: ["$.data.cases", "blockedBy"],
      }),
      sampler({
        name: "T3-1 移除依赖",
        method: "DELETE",
        path: `/api/v1/projects/\${PROJECT_ID}/cases/\${CASE_B}/dependencies/\${DEP_ID}`,
      }),
    ]),
    unauthGroup({
      name: "T4-1 未登录读依赖 401(10001)",
      method: "GET",
      path: `/api/v1/projects/${FAKE_PID}/cases/11111111-2222-4333-8444-555555555555/dependencies`,
      status: 401,
      code: 10001,
    }),
  ],
);

// ═══════ DASH-002 待办跟进 ═══════
const plan002dash = plan(
  "DASH-002 待办跟进（七维度/创建人口径/待办接口域）",
  {
    EMAIL: "jm-s4d2-${__time(yyyyMMddHHmmss)}-${__threadNum}@rabbit.test",
    TS: "${__time(yyyyMMddHHmmss)}",
  },
  [
    threadGroup("关注与三区主链路", [
      ...registerSetup().map(sampler),
      ...caseModule().map(sampler),
      ...apiModule().map(sampler),
      ...[createPlan("关注计划")].map(sampler),
      sampler({
        name: "T1-1 关注计划（幂等首帧）",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/follow`,
        body: {},
        field: ["$.data.followed", "true"],
        field2: ["$.data.idempotent", "false"],
      }),
      sampler({
        name: "T1-2 我关注的 kind=plan 可见",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/dashboard/followed?kind=plan`,
        field: ["$.data.total", "1"],
        contains: ["$.data.items[0].title", "jm-s4-"],
      }),
      sampler({
        name: "T1-3 kind=scenario 为空（维度隔离）",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/dashboard/followed?kind=scenario`,
        field: ["$.data.total", "0"],
      }),
      sampler({
        name: "T1-4 我创建的（plan） createdBy 口径",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/dashboard/created?kind=plan`,
        field: ["$.data.total", "1"],
        contains: ["$.data.items[0].title", "jm-s4-"],
      }),
      sampler({
        name: "T1-5 我创建的（scenario）为空（修正口径回归）",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/dashboard/created?kind=scenario`,
        field: ["$.data.total", "0"],
      }),
      // 待办接口域：关联接口用例并指派执行人
      sampler({
        name: "T0.4 建接口定义+用例",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/apis",
        body: {
          moduleId: "\${MODULE_API}",
          name: `jm-s4-关注接口-${TS()}`,
          request: {
            spec: {
              method: "GET",
              url: "/x",
              headers: [],
              query: [],
              body: { kind: "none" },
              auth: { kind: "none" },
            },
            asserts: [],
            pre: [],
            post: [],
            extracts: [],
          },
        },
        status: 201,
        extract: { var: "API_ID", path: "$.data.id" },
      }),
      sampler({
        name: "T0.5 建接口用例",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/apis/\${API_ID}/cases`,
        body: {
          name: "关注-接口用例",
          level: "P1",
          status: "UNDERWAY",
          tags: [],
          request: {
            spec: {
              method: "GET",
              url: "/x",
              headers: [],
              query: [],
              body: { kind: "none" },
              auth: { kind: "none" },
            },
            asserts: [],
            pre: [],
            post: [],
            extracts: [],
          },
        },
        status: 201,
        extract: { var: "ACASE_ID", path: "$.data.id" },
      }),
      sampler({
        name: "T1-6 接口用例入计划（指派执行人=本人）",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/cases`,
        body: { apiCaseIds: ["${ACASE_ID}"], execUserId: "${USER_ID}" },
      }),
      sampler({
        name: "T1-7 我的待办（exec）含接口用例行",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/dashboard/todo?kind=exec`,
        contains: ["$.data.items", "关注-接口用例"],
      }),
      sampler({
        name: "T1-8 取关后 kind=plan 为空",
        method: "DELETE",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/follow`,
      }),
      sampler({
        name: "T1-9 我关注的 kind=plan 归零",
        method: "GET",
        path: `/api/v1/projects/\${PROJECT_ID}/dashboard/followed?kind=plan`,
        field: ["$.data.total", "0"],
      }),
      sampler({
        name: "T2-1 关注不存在计划 404(30504)",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/11111111-2222-4333-8444-555555555555/follow`,
        body: {},
        status: 404,
        code: 30504,
      }),
      sampler({
        name: "T3-1 重复关注幂等（idempotent=true）",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/follow`,
        body: {},
      }),
      sampler({
        name: "T3-2 再关注一次 → 幂等",
        method: "POST",
        path: `/api/v1/projects/\${PROJECT_ID}/plans/\${PLAN_ID}/follow`,
        body: {},
        field: ["$.data.idempotent", "true"],
      }),
    ]),
    unauthGroup({
      name: "T2-2 未登录读我关注的 401(10001)",
      method: "GET",
      path: `/api/v1/projects/${FAKE_PID}/dashboard/followed`,
      status: 401,
      code: 10001,
    }),
  ],
);

// ═══════ 写出 ═══════
const OUT = [
  ["PLAN-002-test-planning-points.jmx", plan002],
  ["PLAN-003-plan-execution.jmx", plan003],
  ["PLAN-004-plan-group-archive.jmx", plan004],
  ["PLAN-005-plan-report-export.jmx", plan005],
  ["CASE-007-mindmap-save.jmx", plan007],
  ["CASE-008-case-dependency.jmx", plan008],
  ["DASH-002-follow-todo.jmx", plan002dash],
];

mkdirSync(path.join(ROOT, "tests/api"), { recursive: true });
for (const [name, content] of OUT) {
  writeFileSync(path.join(ROOT, "tests/api", name), content);
  console.log(`[gen-jmx-s4] 写出 ${name}（${(content.length / 1024).toFixed(1)}KB）`);
}
