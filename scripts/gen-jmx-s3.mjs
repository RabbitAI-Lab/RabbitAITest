#!/usr/bin/env node
/**
 * Sprint 3 JMeter 用例生成器：从声明式定义生成 tests/api/{API-006..010}-*.jmx。
 * 规范 rules/testing §2：四类场景（正常/401·403·404/422/分页信封）×四项断言
 * （HTTP 状态码 / 业务码 code / 关键字段 JSONPath / 响应时间上限）。
 * S2 勘误吸收：非 2xx 采样器状态码断言 assume_success=true；轮询用单线程组内
 * WhileController（jexl3 条件 + Counter + Timer，变量线程内共享）；未登录采样器
 * 独立无 Cookie 组且路径用固定假 UUID（认证层先行拦截，路径不参与判定）。
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
  const extract = d.extract
    ? `
          <JSONPostProcessor guiclass="JSONPostProcessorGui" testclass="JSONPostProcessor" testname="提取 ${d.extract.var}">
            <stringProp name="JSONPostProcessor.referenceNames">${d.extract.var}</stringProp>
            <stringProp name="JSONPostProcessor.jsonPathExprs">${esc(d.extract.path)}</stringProp>
            <stringProp name="JSONPostProcessor.match_numbers">1</stringProp>
            <stringProp name="JSONPostProcessor.defaultValues">NOT_FOUND</stringProp>
          </JSONPostProcessor>
          <hashTree/>`
    : "";
  let bodyProp = "";
  if (d.multipart !== undefined) {
    bodyProp = `
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments">
            <collectionProp name="Arguments.arguments">
              <elementProp name="" elementType="HTTPArgument">
                <boolProp name="HTTPArgument.always_encode">false</boolProp>
                <stringProp name="Argument.value">${esc(d.multipart).split("\r\n").join("&#13;\n")}</stringProp>
                <stringProp name="Argument.metadata">=</stringProp>
              </elementProp>
            </collectionProp>
          </elementProp>`;
  } else if (d.body !== undefined) {
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
  // multipart 手写边界体必须显式带 Content-Type（S2 PROJ-004 同款 HeaderManager）
  const headerManager = d.multipart
    ? `
        <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="multipart 边界头">
          <collectionProp name="HeaderManager.headers">
            <elementProp name="" elementType="Header">
              <stringProp name="Header.name">Content-Type</stringProp>
              <stringProp name="Header.value">multipart/form-data; boundary=RABBITBOUNDARY</stringProp>
            </elementProp>
          </collectionProp>
        </HeaderManager>
        <hashTree/>`
    : "";
  return `${headerManager}
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

/** WhileController 轮询块（S2 API-003 同款：jexl3 终态判断 + Counter + 500ms）。 */
function whilePoll(taskIdVar, prefix = "") {
  const i = `LOOP${prefix}_I`;
  const st = `STATUS${prefix}`;
  return `
        <WhileController guiclass="WhileControllerGui" testclass="WhileController" testname="轮询至终态（上限 20 次）">
          <stringProp name="WhileController.condition">\${__jexl3(\${${i}} &lt; 20 &amp;&amp; &quot;\${${st}}&quot; != &quot;SUCCESS&quot; &amp;&amp; &quot;\${${st}}&quot; != &quot;FAILED&quot; &amp;&amp; &quot;\${${st}}&quot; != &quot;STOPPED&quot;)}</stringProp>
        </WhileController>
        <hashTree>${sampler({
          name: "轮询报告状态",
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
];
const defaultModule = () => [
  {
    name: "T0.1 取默认模块（scene=scenario）",
    method: "GET",
    path: "/api/v1/projects/${PROJECT_ID}/modules?scene=scenario",
    contains: ["$.data.items[0].id", "-"],
    extract: { var: "MODULE_ID", path: "$.data.items[0].id" },
  },
];
const unauthGroup = (s) => threadGroup("未登录（无 Cookie）", [sampler(s)], false);

/** custom 请求步骤（GET mock + 可选断言）。 */
const customStep = (name, url, asserts = []) => ({
  uid: `u-${name}`,
  stepType: "custom",
  name,
  enabled: true,
  config: {
    bundle: {
      request: {
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
    },
  },
  children: [],
});

// ═══════ API-006 场景编排 ═══════
const api006 = plan(
  "API-006 场景编排（CRUD/步骤树/执行/回收站）",
  {
    EMAIL: "jm-s3a6-${__time(yyyyMMddHHmmss)}-${__threadNum}@rabbit.test",
    TS: "${__time(yyyyMMddHHmmss)}",
  },
  [
    threadGroup("场景主链路", [
      ...registerSetup().map(sampler),
      ...defaultModule().map(sampler),
      sampler({
        name: "T1-1 创建场景",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios",
        body: { name: `jm-s3-场景-${TS()}`, moduleId: "${MODULE_ID}", level: "P1" },
        status: 201,
        contains: ["$.data.num", ""],
        extract: { var: "SC_ID", path: "$.data.id" },
      }),
      sampler({
        name: "T1-2 保存步骤树（custom+script+wait）",
        method: "PUT",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${SC_ID}/steps",
        body: {
          version: 1,
          steps: [
            customStep("请求", MOCK()),
            {
              uid: "u-sc",
              stepType: "script",
              name: "脚本",
              enabled: true,
              config: { script: 'setVar("k", "v")' },
              children: [],
            },
            {
              uid: "u-wait",
              stepType: "wait",
              name: "等待",
              enabled: true,
              config: { ms: 10 },
              children: [],
            },
          ],
        },
        field: ["$.data.stepCount", "3"],
      }),
      sampler({
        name: "T1-3 读取详情（步骤树回读）",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${SC_ID}",
        field: ["$.data.steps[0].stepType", "custom"],
      }),
      sampler({
        name: "T1-4 执行场景",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${SC_ID}/execute",
        body: {},
        status: 201,
        extract: { var: "TASK_ID", path: "$.data.taskId" },
        duration: 8000,
      }),
      whilePoll("TASK_ID"),
      sampler({
        name: "T1-5 报告 type=scenario 且 SUCCESS",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/reports/${TASK_ID}",
        field: ["$.data.type", "scenario"],
        contains: ["$.data.status", "SUCCESS"],
        extract: { var: "ITEM_ID", path: "$.data.items[0].itemId" },
      }),
      sampler({
        name: "T1-6 场景树视图 stats.total=3",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/reports/${TASK_ID}/items/${ITEM_ID}/scenario-tree",
        field: ["$.data.stats.total", "3"],
      }),
      sampler({
        name: "T2-2 随机场景详情 404(40474)",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/11111111-2222-4333-8444-555555555555",
        status: 404,
        code: 40474,
      }),
      sampler({
        name: "T3-1 空名创建 422(20422)",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios",
        body: { name: "", moduleId: "${MODULE_ID}" },
        status: 422,
        code: 20422,
      }),
      sampler({
        name: "T4-1 列表分页信封 pageSize=2",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios?page=1&pageSize=2",
        field: ["$.data.total", "1"],
        contains: ["$.data.items[0].name", "jm-s3-"],
      }),
      sampler({
        name: "T1-7 软删入回收站",
        method: "DELETE",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${SC_ID}",
      }),
      sampler({
        name: "T1-8 回收站列表 recycle=true",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios?recycle=true",
        field: ["$.data.total", "1"],
      }),
      sampler({
        name: "T1-9 彻底删除",
        method: "DELETE",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${SC_ID}/purge",
      }),
    ]),
    unauthGroup({
      name: "T2-1 未登录读场景列表 401(10001)",
      method: "GET",
      path: `/api/v1/projects/${FAKE_PID}/scenarios`,
      status: 401,
      code: 10001,
    }),
  ],
);

// ═══════ API-007 参数化 ═══════
const api007 = plan(
  "API-007 场景参数化（常量/列表/CSV/foreach 迭代）",
  {
    EMAIL: "jm-s3a7-${__time(yyyyMMddHHmmss)}-${__threadNum}@rabbit.test",
    TS: "${__time(yyyyMMddHHmmss)}",
  },
  [
    threadGroup("参数化主链路", [
      ...registerSetup().map(sampler),
      ...defaultModule().map(sampler),
      sampler({
        name: "T1-1 创建场景（带参数体系）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios",
        body: {
          name: `jm-s3-参数-${TS()}`,
          moduleId: "${MODULE_ID}",
          config: {
            params: {
              constants: [{ name: "host", value: "http://h", description: "" }],
              lists: [{ name: "users", values: ["alice", "bob", "carol"] }],
              csv: {
                source: "inline",
                inlineText: "name,email\nalice,a@x.io\nbob,b@x.io\n",
                delimiter: ",",
                hasHeader: true,
              },
            },
            prePost: { pre: [], post: [] },
            asserts: [],
            settings: { cookieMode: "off", thinkTimeMs: 0, onFailure: "abort" },
          },
        },
        status: 201,
        extract: { var: "SC_ID", path: "$.data.id" },
      }),
      sampler({
        name: "T1-2 详情回读列表参数",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${SC_ID}",
        field: ["$.data.config.params.lists[0].values[0]", "alice"],
      }),
      sampler({
        name: "T1-3 保存 foreach 步骤树（绑定列表 users）",
        method: "PUT",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${SC_ID}/steps",
        body: {
          version: 1,
          steps: [
            {
              uid: "u-loop",
              stepType: "loop",
              name: "遍历用户",
              enabled: true,
              config: { mode: "foreach", var: "user", source: "users", iterations: [] },
              children: [customStep("用例", `${MOCK()}/\${user}`)],
            },
          ],
        },
        field: ["$.data.stepCount", "2"],
      }),
      sampler({
        name: "T1-4 执行场景",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${SC_ID}/execute",
        body: {},
        status: 201,
        extract: { var: "TASK_ID", path: "$.data.taskId" },
        duration: 8000,
      }),
      whilePoll("TASK_ID"),
      sampler({
        name: "T1-5 报告 SUCCESS",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/reports/${TASK_ID}",
        field: ["$.data.type", "scenario"],
        contains: ["$.data.status", "SUCCESS"],
        extract: { var: "ITEM_ID", path: "$.data.items[0].itemId" },
      }),
      sampler({
        name: "T1-6 变量终值 user=carol（末行迭代）",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/reports/${TASK_ID}/items/${ITEM_ID}/scenario-tree",
        field: ["$.data.varsFinal.user", "carol"],
      }),
      sampler({
        name: "T3-1 列表名空 422(20422)",
        method: "PUT",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${SC_ID}",
        body: {
          name: `jm-s3-参数-${TS()}`,
          moduleId: "${MODULE_ID}",
          level: "P2",
          status: "UNDERWAY",
          tags: [],
          version: 1,
          config: {
            params: {
              constants: [],
              lists: [{ name: "", values: ["x"] }],
              csv: { source: "inline", delimiter: ",", hasHeader: true },
            },
            prePost: { pre: [], post: [] },
            asserts: [],
            settings: { cookieMode: "off", thinkTimeMs: 0, onFailure: "abort" },
          },
        },
        status: 422,
        code: 20422,
      }),
      sampler({
        name: "T4-1 列表分页信封",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios?page=1&pageSize=1",
        field: ["$.data.total", "1"],
      }),
      sampler({
        name: "清理",
        method: "DELETE",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${SC_ID}/purge",
      }),
    ]),
    unauthGroup({
      name: "T2-1 未登录读场景列表 401(10001)",
      method: "GET",
      path: `/api/v1/projects/${FAKE_PID}/scenarios`,
      status: 401,
      code: 10001,
    }),
  ],
);

// ═══════ API-008 批量执行与定时 ═══════
const api008 = plan(
  "API-008 场景批量执行与定时任务",
  {
    EMAIL: "jm-s3a8-${__time(yyyyMMddHHmmss)}-${__threadNum}@rabbit.test",
    TS: "${__time(yyyyMMddHHmmss)}",
  },
  [
    threadGroup("批量执行与定时", [
      ...registerSetup().map(sampler),
      ...defaultModule().map(sampler),
      sampler({
        name: "T1-1 建场景 A",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios",
        body: { name: `jm-s3-批量A-${TS()}`, moduleId: "${MODULE_ID}" },
        status: 201,
        extract: { var: "SC_A", path: "$.data.id" },
      }),
      sampler({
        name: "T1-2 建场景 B",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios",
        body: { name: `jm-s3-批量B-${TS()}`, moduleId: "${MODULE_ID}" },
        status: 201,
        extract: { var: "SC_B", path: "$.data.id" },
      }),
      sampler({
        name: "T1-3 A 存步骤",
        method: "PUT",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${SC_A}/steps",
        body: { version: 1, steps: [customStep("a", MOCK())] },
      }),
      sampler({
        name: "T1-4 B 存步骤",
        method: "PUT",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${SC_B}/steps",
        body: { version: 1, steps: [customStep("b", MOCK())] },
      }),
      sampler({
        name: "T1-5 批量执行（并行）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/execute",
        body: { scenarioIds: ["${SC_A}", "${SC_B}"], mode: "parallel", stopOnFail: false },
        status: 201,
        extract: { var: "TASK_ID", path: "$.data.taskId" },
        duration: 8000,
      }),
      whilePoll("TASK_ID"),
      sampler({
        name: "T1-6 报告两执行项且 SUCCESS",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/reports/${TASK_ID}",
        field: ["$.data.summary.total", "2"],
        contains: ["$.data.status", "SUCCESS"],
      }),
      sampler({
        name: "T4-1 任务列表分页（type=scenario）",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/exec-tasks?type=scenario&page=1&pageSize=1",
        contains: ["$.data.items[0].type", "scenario"],
      }),
      sampler({
        name: "T1-7 批量复制",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/batch-copy",
        body: { ids: ["${SC_A}", "${SC_B}"] },
        status: 201,
        field: ["$.data.count", "2"],
        extract: { var: "COPY_ID", path: "$.data.list[0].id" },
      }),
      sampler({
        name: "T1-8 批量移动回原模块",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/batch-move",
        body: { ids: ["${COPY_ID}"], moduleId: "${MODULE_ID}" },
        field: ["$.data.count", "1"],
      }),
      sampler({
        name: "T1-9 批量删除（复制件）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/batch-delete",
        body: { ids: ["${COPY_ID}"] },
        field: ["$.data.count", "1"],
      }),
      sampler({
        name: "T2-1 建定时（每天 09:00）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenario-schedules",
        body: {
          name: `jm-s3-定时-${TS()}`,
          cron: "0 9 * * *",
          scenarioIds: ["${SC_A}"],
          enabled: true,
          notify: false,
        },
        status: 201,
        extract: { var: "SCH_ID", path: "$.data.id" },
      }),
      sampler({
        name: "T2-2 cron 每分钟 422(50005)",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenario-schedules",
        body: { name: "bad", cron: "* * * * *", scenarioIds: ["${SC_A}"] },
        status: 422,
        code: 50005,
      }),
      sampler({
        name: "T2-3 定时列表 total=1",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/scenario-schedules",
        field: ["$.data.total", "1"],
      }),
      sampler({
        name: "T2-4 停用",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenario-schedules/${SCH_ID}/toggle",
        body: { enabled: false },
        field: ["$.data.enabled", "false"],
      }),
      sampler({
        name: "T2-5 启用",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenario-schedules/${SCH_ID}/toggle",
        body: { enabled: true },
        field: ["$.data.enabled", "true"],
      }),
      sampler({
        name: "T2-6 立即执行",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenario-schedules/${SCH_ID}/run",
        body: {},
        status: 201,
        contains: ["$.data.taskId", "-"],
        duration: 8000,
      }),
      sampler({
        name: "T2-7 删除定时",
        method: "DELETE",
        path: "/api/v1/projects/${PROJECT_ID}/scenario-schedules/${SCH_ID}",
      }),
      sampler({
        name: "T3-1 scenarioIds 空 422(20422)",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/execute",
        body: { scenarioIds: [] },
        status: 422,
        code: 20422,
      }),
      sampler({
        name: "清理 A",
        method: "DELETE",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${SC_A}/purge",
      }),
      sampler({
        name: "清理 B",
        method: "DELETE",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${SC_B}/purge",
      }),
    ]),
    unauthGroup({
      name: "T2-8 未登录建定时 401(10001)",
      method: "POST",
      path: `/api/v1/projects/${FAKE_PID}/scenario-schedules`,
      body: { name: "x", cron: "0 9 * * *", scenarioIds: ["00000000-0000-0000-0000-0000000000f1"] },
      status: 401,
      code: 10001,
    }),
  ],
);

// ═══════ API-009 导入导出 ═══════
const rabbitImportBody = (name) =>
  `--RABBITBOUNDARY\r
Content-Disposition: form-data; name="file"; filename="jm-s3-${TS()}.json"\r
Content-Type: application/json\r
\r
{"format":"rabbit-scenario","formatVersion":1,"mode":"ref","scenarios":[{"name":"${name}","level":"P2","status":"UNDERWAY","tags":[],"modulePath":"","config":{"params":{"constants":[],"lists":[],"csv":{"source":"inline","delimiter":",","hasHeader":true}},"prePost":{"pre":[],"post":[]},"asserts":[],"settings":{"cookieMode":"off","thinkTimeMs":0,"onFailure":"abort"}},"steps":[{"uid":"u1","stepType":"custom","name":"导入的请求","enabled":true,"config":{"bundle":{"request":{"method":"GET","url":"${MOCK()}","headers":[],"query":[],"body":{"kind":"none"},"auth":{"kind":"none"}},"asserts":[],"pre":[],"post":[],"extracts":[]}},"children":[]}]}]}\r
--RABBITBOUNDARY--\r
`;

const msImportBody = `--RABBITBOUNDARY\r
Content-Disposition: form-data; name="file"; filename="jm-s3-${TS()}.json"\r
Content-Type: application/json\r
\r
{"format":"metersphere","scenarios":[{"name":"MS 导入场景","steps":[]}]}\r
--RABBITBOUNDARY--\r
`;

const jmxImportBody = `--RABBITBOUNDARY\r
Content-Disposition: form-data; name="file"; filename="jm-s3-${TS()}.jmx"\r
Content-Type: application/xml\r
\r
<?xml version="1.0" encoding="UTF-8"?>\r
<jmeterTestPlan version="1.2">\r
  <TestPlan testname="jmeter 导入流程" enabled="true"></TestPlan>\r
  <hashTree>\r
    <ThreadGroup testname="TG" enabled="true"></ThreadGroup>\r
    <hashTree>\r
      <HTTPSamplerProxy testname="注册" enabled="true">\r
        <stringProp name="HTTPSampler.method">POST</stringProp>\r
        <stringProp name="HTTPSampler.domain">127.0.0.1</stringProp>\r
        <stringProp name="HTTPSampler.port">4000</stringProp>\r
        <stringProp name="HTTPSampler.path">/mock/10001/users</stringProp>\r
      </HTTPSamplerProxy>\r
      <hashTree/>\r
    </hashTree>\r
  </hashTree>\r
</jmeterTestPlan>\r
--RABBITBOUNDARY--\r
`;

const badImportBody = `--RABBITBOUNDARY\r
Content-Disposition: form-data; name="file"; filename="jm-s3-${TS()}.json"\r
Content-Type: application/json\r
\r
not-a-json\r
--RABBITBOUNDARY--\r
`;

const api009 = plan(
  "API-009 场景导入导出",
  {
    EMAIL: "jm-s3a9-${__time(yyyyMMddHHmmss)}-${__threadNum}@rabbit.test",
    TS: "${__time(yyyyMMddHHmmss)}",
  },
  [
    threadGroup("导入导出主链路", [
      ...registerSetup().map(sampler),
      ...defaultModule().map(sampler),
      sampler({
        name: "T1-1 建场景",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios",
        body: { name: `jm-s3-导出源-${TS()}`, moduleId: "${MODULE_ID}" },
        status: 201,
        extract: { var: "SC_ID", path: "$.data.id" },
      }),
      sampler({
        name: "T1-2 导出（保留引用 · attachment 流）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/export",
        body: { ids: ["${SC_ID}"], mode: "ref" },
        binary: true,
        duration: 5000,
      }),
      sampler({
        name: "T1-3 导入预览（Rabbit JSON）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/import/preview",
        multipart: rabbitImportBody(`jm-s3-导入-${TS()}`),
        field: ["$.data.format", "rabbit-scenario"],
        contains: ["$.data.scenarioCount", "1"],
      }),
      sampler({
        name: "T1-4 导入落库",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/import",
        multipart: rabbitImportBody(`jm-s3-导入-${TS()}`),
        status: 201,
        field: ["$.data.count", "1"],
        extract: { var: "IMP_ID", path: "$.data.list[0].id" },
      }),
      sampler({
        name: "T1-5 导入后列表 total=2",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios?page=1&pageSize=10",
        field: ["$.data.total", "2"],
      }),
      sampler({
        name: "T1-6 MeterSphere 格式预览",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/import/preview",
        multipart: msImportBody,
        field: ["$.data.format", "metersphere"],
      }),
      sampler({
        name: "T1-7 jmx 导入预览",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/import/preview",
        multipart: jmxImportBody,
        field: ["$.data.format", "jmx"],
      }),
      sampler({
        name: "T2-1 坏内容 422(50011)",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/import/preview",
        multipart: badImportBody,
        status: 422,
        code: 50011,
      }),
      sampler({
        name: "T3-1 导出空 ids 422(20422)",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/export",
        body: { ids: [], mode: "ref" },
        status: 422,
        code: 20422,
      }),
      sampler({
        name: "T4-1 列表分页信封",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios?page=1&pageSize=2",
        field: ["$.data.total", "2"],
      }),
      sampler({
        name: "清理导入件",
        method: "DELETE",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${IMP_ID}/purge",
      }),
      sampler({
        name: "清理源场景",
        method: "DELETE",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${SC_ID}/purge",
      }),
    ]),
    unauthGroup({
      name: "T2-2 未登录导入预览 401(10001)",
      method: "POST",
      path: `/api/v1/projects/${FAKE_PID}/scenarios/import/preview`,
      multipart: badImportBody,
      status: 401,
      code: 10001,
    }),
  ],
);

// ═══════ API-010 误报规则 ═══════
const api010 = plan(
  "API-010 误报规则（FAKE_ERROR 改判链路）",
  {
    EMAIL: "jm-s3b0-${__time(yyyyMMddHHmmss)}-${__threadNum}@rabbit.test",
    TS: "${__time(yyyyMMddHHmmss)}",
  },
  [
    threadGroup("误报规则与改判链路", [
      ...registerSetup().map(sampler),
      ...defaultModule().map(sampler),
      sampler({
        name: "T1-1 建规则（状态码=200）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/false-alarm-rules",
        body: {
          name: `jm-s3-规则-${TS()}`,
          matcher: { status: 200 },
          enabled: true,
          description: "",
        },
        status: 201,
        extract: { var: "RULE_ID", path: "$.data.id" },
      }),
      sampler({
        name: "T1-2 规则列表 total=1",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/false-alarm-rules",
        field: ["$.data.total", "1"],
      }),
      sampler({
        name: "T1-3 更新规则（状态码 502）",
        method: "PUT",
        path: "/api/v1/projects/${PROJECT_ID}/false-alarm-rules/${RULE_ID}",
        body: {
          name: `jm-s3-规则-${TS()}`,
          matcher: { status: 502 },
          enabled: true,
          description: "",
        },
      }),
      sampler({
        name: "T1-4 更新回状态码规则（误报链路用）",
        method: "PUT",
        path: "/api/v1/projects/${PROJECT_ID}/false-alarm-rules/${RULE_ID}",
        body: {
          name: `jm-s3-规则-${TS()}`,
          matcher: { status: 200 },
          enabled: true,
          description: "",
        },
      }),
      sampler({
        name: "T2-1 建失败场景（断言故意 eq 500）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios",
        body: { name: `jm-s3-误报-${TS()}`, moduleId: "${MODULE_ID}" },
        status: 201,
        extract: { var: "SC_ID", path: "$.data.id" },
      }),
      sampler({
        name: "T2-2 存必败步骤",
        method: "PUT",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${SC_ID}/steps",
        body: {
          version: 1,
          steps: [
            customStep("必败", MOCK(), [
              { kind: "status_code", path: "", op: "eq", expected: "500" },
            ]),
          ],
        },
      }),
      sampler({
        name: "T2-3 执行",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${SC_ID}/execute",
        body: {},
        status: 201,
        extract: { var: "TASK_ID", path: "$.data.taskId" },
        duration: 8000,
      }),
      whilePoll("TASK_ID"),
      sampler({
        name: "T2-4 命中规则 → item=FAKE_ERROR 且单列统计",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/reports/${TASK_ID}",
        field: ["$.data.items[0].status", "FAKE_ERROR"],
        contains: ["$.data.summary.fakeError", "1"],
      }),
      sampler({
        name: "T2-5 停用规则",
        method: "PUT",
        path: "/api/v1/projects/${PROJECT_ID}/false-alarm-rules/${RULE_ID}",
        body: {
          name: `jm-s3-规则-${TS()}`,
          matcher: { status: 200 },
          enabled: false,
          description: "",
        },
      }),
      sampler({
        name: "T2-6 重跑不再标记",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${SC_ID}/execute",
        body: {},
        status: 201,
        extract: { var: "TASK2_ID", path: "$.data.taskId" },
        duration: 8000,
      }),
      whilePoll("TASK2_ID", "2"),
      sampler({
        name: "T2-7 对照报告 item=FAILED 且 fakeError=0",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/reports/${TASK2_ID}",
        field: ["$.data.items[0].status", "FAILED"],
        contains: ["$.data.summary.fakeError", "0"],
      }),
      sampler({
        name: "T3-1 空 matcher 422(50007)",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/false-alarm-rules",
        body: { name: "bad", matcher: {}, enabled: true, description: "" },
        status: 422,
        code: 50007,
      }),
      sampler({
        name: "T4-1 规则列表信封",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/false-alarm-rules",
        field: ["$.data.total", "1"],
      }),
      sampler({
        name: "T1-5 删除规则",
        method: "DELETE",
        path: "/api/v1/projects/${PROJECT_ID}/false-alarm-rules/${RULE_ID}",
      }),
      sampler({
        name: "清理场景",
        method: "DELETE",
        path: "/api/v1/projects/${PROJECT_ID}/scenarios/${SC_ID}/purge",
      }),
    ]),
    unauthGroup({
      name: "T2-8 未登录读规则 401(10001)",
      method: "GET",
      path: `/api/v1/projects/${FAKE_PID}/false-alarm-rules`,
      status: 401,
      code: 10001,
    }),
  ],
);

// ═══════ 写出 ═══════
const OUT = [
  ["API-006-scenario-orchestration.jmx", api006],
  ["API-007-scenario-params-csv.jmx", api007],
  ["API-008-scenario-execution-batch.jmx", api008],
  ["API-009-scenario-import-export.jmx", api009],
  ["API-010-false-alarm-rules.jmx", api010],
];

mkdirSync(path.join(ROOT, "tests/api"), { recursive: true });
for (const [name, content] of OUT) {
  writeFileSync(path.join(ROOT, "tests/api", name), content);
  console.log(`[gen-jmx-s3] 写出 ${name}（${(content.length / 1024).toFixed(1)}KB）`);
}
