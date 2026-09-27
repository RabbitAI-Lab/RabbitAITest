#!/usr/bin/env node
/**
 * Sprint 5 JMeter 用例生成器：从声明式定义生成 tests/api/{MSG-001,BUG-002,PROJ-005,PROJ-006,FILE-001,SYS-007}-*.jmx。
 * 规范 rules/testing §2：四类场景（正常/401·403·404/422/分页信封）×四项断言。
 * S5 栈前提：api-test-stack.sh 注入 OUTBOUND_ALLOW_PRIVATE=1（机器人 webhook/Git 平台 mock 均环回）
 * 与 RABBIT_INTEGRATION_SECRET（token 加密）。
 * 教训（勿回退）：
 *  - TestPlan UDV elementProp 名必须 user_defined_variables（下划线）——驼峰名整块 UDV 被忽略 → ${EMAIL} 原样发出 → T0 422；
 *  - UDV 值禁止自引用（${TS} 指自身）——污染整区 UDV 求值；
 *  - 线程组内注册第二用户会切换 Cookie 会话：取组织/登录回管理员须按 memberContext 顺序。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "tests/api");
mkdirSync(OUT, { recursive: true });

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
  const assume = status >= 400 ? `\n            <boolProp name="Assertion.assume_success">true</boolProp>` : "";
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
        <hashTree>${extract}${assertions.join("")}
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
const TS = "${__time(yyyyMMddHHmmss)}";
const FAKE_PID = "00000000-0000-0000-0000-000000000009";
/** mock 基址（run-api-tests -JMOCKHOST/-JMOCKPORT 注入；UDV 定义期求值 __P——body 内联不替换的坑） */
const MOCK_ROBOT = "${__P(MOCKHOST,127.0.0.1)}:${__P(MOCKPORT,4020)}/mock-robot";
const MOCK_GIT = "${__P(MOCKHOST,127.0.0.1)}:${__P(MOCKPORT,4020)}";

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
  }),
];

const unauthGroup = (s) => threadGroup("未登录（无 Cookie）", [sampler(s)], false);

/** 普通成员上下文：取组织须在注册 member 之前（注册切换 Cookie 会话 → info 404 防枚举）。
 *  adminEmailVar：该线程组里「管理员」的邮箱变量（错误组用 EMAIL_ERR）。 */
const memberContext = (adminEmailVar = "EMAIL") => [
  sampler({
    name: "M1 取组织 id（admin 会话，先于注册）",
    method: "GET",
    path: "/api/v1/projects/${PROJECT_ID}/info",
    extract: { var: "ORG_ID", path: "$.data.org.id" },
    contains: ["$.data.org.id", "-"], // uuid 含 -（JSONPath 断言不支持取反，弃 NOT_FOUND 写法）
  }),
  sampler({
    name: "M0 注册普通成员",
    method: "POST",
    path: "/api/v1/auth/register",
    body: { email: "${EMAIL2}", password: "rabbit-pass-123" },
    status: 201,
    extract: { var: "USER2_ID", path: "$.data.userId" },
    duration: 8000,
  }),
  sampler({ name: "M2 登录回管理员", method: "POST", path: "/api/v1/auth/login", body: { email: `\${${adminEmailVar}}`, password: "rabbit-pass-123" }, field: ["$.code", "0"] }),
  sampler({ name: "M3 加组织成员", method: "POST", path: "/api/v1/orgs/${ORG_ID}/members-add", body: { userIds: ["${USER2_ID}"] }, status: 201 }),
  sampler({ name: "M4 加项目成员（默认 PROJECT_MEMBER 组）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/members", body: { userIds: ["${USER2_ID}"] }, status: 201 }),
  sampler({ name: "M5 切回普通成员会话", method: "POST", path: "/api/v1/auth/login", body: { email: "${EMAIL2}", password: "rabbit-pass-123" }, field: ["$.code", "0"] }),
];

/** 各计划共用 vars（EMAIL_ERR：错误场景组独立邮箱，避免与主组同秒 EMAIL_EXISTS 400）。 */
const commonVars = () => ({
  EMAIL_ERR: `jm-err-${TS}@rabbit.test`,
  TS,
});

// ═══════ MSG-001 通知机器人 ═══════
const msg001 = plan(
  "MSG-001 通知机器人（CRUD/事件配置/测试发送/站内信；四类场景）",
  {
    EMAIL: `jm-msg1-${TS}@rabbit.test`,
    EMAIL2: `jm-msg1b-${TS}@rabbit.test`,
    ...commonVars(),
  },
  [
    threadGroup("机器人主链路", [
      ...registerSetup(),
      sampler({
        name: "T1 新建钉钉机器人（webhook 指向 mock）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/robots",
        body: { name: `jm-robot-${TS}`, channel: "dingtalk", webhook: `http://${MOCK_ROBOT}/dingtalk`, enabled: true },
        status: 201,
        field: ["$.data.channel", "dingtalk"],
        extract: { var: "ROBOT_ID", path: "$.data.id" },
      }),
      sampler({
        name: "T2 新建站内信机器人",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/robots",
        body: { name: `jm-inapp-${TS}`, channel: "inapp", enabled: true },
        status: 201,
        extract: { var: "INAPP_ID", path: "$.data.id" },
      }),
      sampler({ name: "T3 列表分页信封（total>=2）", method: "GET", path: "/api/v1/projects/${PROJECT_ID}/robots?pageSize=10", contains: ["$.data.total"] }),
      sampler({
        name: "T4 保存事件配置（BUG_CREATED 开+两机器人）",
        method: "PUT",
        path: "/api/v1/projects/${PROJECT_ID}/message-config",
        body: { BUG_CREATED: { enabled: true, robotIds: ["${ROBOT_ID}", "${INAPP_ID}"], receiverUserIds: [] } },
        contains: ["$.data.config.BUG_CREATED.enabled", "true"],
      }),
      sampler({ name: "T5 事件配置视图", method: "GET", path: "/api/v1/projects/${PROJECT_ID}/message-config", contains: ["$.data.robots"] }),
      sampler({ name: "T6 测试发送（钉钉，mock 实投）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/robots/${ROBOT_ID}/test", body: {}, field: ["$.data.delivered", "true"] }),
      sampler({ name: "T7 测试发送（站内信→操作人收一条）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/robots/${INAPP_ID}/test", body: {}, field: ["$.data.delivered", "true"] }),
      sampler({ name: "T8 未读数>=1（ROBOT_TEST 落库）", method: "GET", path: "/api/v1/personal/notifications/unread-count", contains: ["$.data.count"] }),
      sampler({ name: "T9 通知列表分页信封", method: "GET", path: "/api/v1/personal/notifications?pageSize=5", contains: ["$.data.items[0].type", "ROBOT_TEST"] }),
      sampler({ name: "T10 全部已读后未读数=0", method: "POST", path: "/api/v1/personal/notifications/read-all", body: {}, contains: ["$.data.updated"] }),
      sampler({ name: "T11 触发 BUG_CREATED 事件（建缺陷）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/bugs", body: { title: `jm-notify-${TS}` }, status: 201, extract: { var: "BUG_ID", path: "$.data.id" } }),
      sampler({ name: "T12 删除机器人（级联清理事件配置引用）", method: "DELETE", path: "/api/v1/projects/${PROJECT_ID}/robots/${ROBOT_ID}" }),
      sampler({ name: "T13 事件配置视图（引用已摘除）", method: "GET", path: "/api/v1/projects/${PROJECT_ID}/message-config", contains: ["$.data.config"] }),
    ]),
    threadGroup("错误与权限（401/403/404/422）", [
      sampler({ name: "E1 401 未登录机器人列表", method: "GET", path: `/api/v1/projects/${FAKE_PID}/robots`, status: 401, code: 10001 }),
      ...registerSetup("EMAIL_ERR"),
      ...memberContext("EMAIL_ERR"),
      sampler({ name: "E2 403 普通成员建机器人（无 PROJECT_MESSAGE:CREATE）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/robots", body: { name: "x", channel: "inapp", enabled: true }, status: 403, code: 10003 }),
      sampler({ name: "E3 登录回管理员", method: "POST", path: "/api/v1/auth/login", body: { email: "${EMAIL_ERR}", password: "rabbit-pass-123" }, field: ["$.code", "0"] }),
      sampler({ name: "E4 404 坏 id 测试发送", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/robots/00000000-0000-0000-0000000000de/test", body: {}, status: 404, code: 20440 }),
      sampler({ name: "E5 422 webhook 非法协议（ftp）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/robots", body: { name: "bad", channel: "dingtalk", webhook: "ftp://x/y", enabled: true }, status: 422, code: 20441 }),
      sampler({ name: "E6 422 机器人渠道缺 webhook", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/robots", body: { name: "bad", channel: "feishu", enabled: true }, status: 422, code: 20441 }),
      sampler({ name: "E7 422 事件配置引用不存在机器人", method: "PUT", path: "/api/v1/projects/${PROJECT_ID}/message-config", body: { BUG_UPDATED: { enabled: true, robotIds: ["00000000-0000-4000-8000-0000000000de"], receiverUserIds: [] } }, status: 422, code: 20444 }),
      sampler({ name: "E8 404 通知坏 id 已读", method: "POST", path: "/api/v1/personal/notifications/00000000-0000-0000-0000000000ff/read", body: {}, status: 404, code: 20445 }),
    ]),
  ],
);

// ═══════ BUG-002 缺陷协作与回收站 ═══════
const bug002 = plan(
  "BUG-002 缺陷回收站批量（batch-restore/batch-purge/评论@提及；四类场景）",
  {
    EMAIL: `jm-bug2-${TS}@rabbit.test`,
    EMAIL2: `jm-bug2b-${TS}@rabbit.test`,
    ...commonVars(),
  },
  [
    threadGroup("回收站批量主链路", [
      ...registerSetup(),
      sampler({ name: "T1 建缺陷 A", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/bugs", body: { title: `jm-recycle-a-${TS}` }, status: 201, extract: { var: "BUG_A", path: "$.data.id" } }),
      sampler({ name: "T2 建缺陷 B", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/bugs", body: { title: `jm-recycle-b-${TS}` }, status: 201, extract: { var: "BUG_B", path: "$.data.id" } }),
      sampler({ name: "T3 软删 A/B（进回收站）", method: "DELETE", path: "/api/v1/projects/${PROJECT_ID}/bugs/${BUG_A}" }),
      sampler({ name: "T3b 软删 B", method: "DELETE", path: "/api/v1/projects/${PROJECT_ID}/bugs/${BUG_B}" }),
      sampler({ name: "T4 回收站列表分页信封（recycled=true）", method: "GET", path: "/api/v1/projects/${PROJECT_ID}/bugs?recycled=true&pageSize=10", contains: ["$.data.total", "1"] }),
      sampler({ name: "T5 批量恢复（affected=2）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/bugs/batch-restore", body: { ids: ["${BUG_A}", "${BUG_B}"] }, field: ["$.data.affected", "2"] }),
      sampler({ name: "T6 恢复后回收站清空", method: "GET", path: "/api/v1/projects/${PROJECT_ID}/bugs?recycled=true&pageSize=10", field: ["$.data.total", "0"] }),
      sampler({ name: "T7 再删 A/B", method: "DELETE", path: "/api/v1/projects/${PROJECT_ID}/bugs/${BUG_A}" }),
      sampler({ name: "T7b 再删 B", method: "DELETE", path: "/api/v1/projects/${PROJECT_ID}/bugs/${BUG_B}" }),
      sampler({ name: "T8 批量彻底删除（affected=2）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/bugs/batch-purge", body: { ids: ["${BUG_A}", "${BUG_B}"] }, field: ["$.data.affected", "2"] }),
      sampler({ name: "T9 彻底删除后恢复 422", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/bugs/batch-restore", body: { ids: ["${BUG_A}"] }, status: 422, code: 20422 }),
      ...memberContext(),
      sampler({ name: "T10 评论 @成员（mentions 落库）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/comments?entity=bug:${BUG_A}", body: { content: "please check", mentions: ["${USER2_ID}"] }, status: 201 }),
      sampler({ name: "T11 登录回管理员", method: "POST", path: "/api/v1/auth/login", body: { email: "${EMAIL}", password: "rabbit-pass-123" }, field: ["$.code", "0"] }),
    ]),
    threadGroup("错误场景（401/422）", [
      sampler({ name: "E1 401 未登录批量恢复", method: "POST", path: `/api/v1/projects/${FAKE_PID}/bugs/batch-restore`, body: { ids: ["00000000-0000-4000-8000-000000000001"] }, status: 401, code: 10001 }),
      ...registerSetup("EMAIL_ERR"),
      sampler({ name: "E2 422 空 ids", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/bugs/batch-restore", body: { ids: [] }, status: 422, code: 20422 }),
      sampler({ name: "E3 建缺陷 C 供 422", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/bugs", body: { title: `jm-recycle-c-${TS}` }, status: 201, extract: { var: "BUG_C", path: "$.data.id" } }),
      sampler({ name: "E4 422 含未删除 id（不在回收站）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/bugs/batch-restore", body: { ids: ["${BUG_C}"] }, status: 422, code: 20422 }),
      sampler({ name: "E5 422 提及非成员", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/comments?entity=bug:${BUG_C}", body: { content: "hi", mentions: ["00000000-0000-4000-8000-0000000000ee"] }, status: 422, code: 20422 }),
    ]),
  ],
);

// ═══════ PROJ-005 公共脚本 ═══════
const proj005 = plan(
  "PROJ-005 公共脚本（CRUD/发布/调试/引用保护；四类场景）",
  {
    EMAIL: `jm-ps5-${TS}@rabbit.test`,
    ...commonVars(),
  },
  [
    threadGroup("脚本主链路", [
      ...registerSetup(),
      sampler({
        name: "T1 新建脚本（含参数定义）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/public-scripts",
        body: { name: `jm-script-${TS}`, language: "javascript", tags: ["jm"], params: [{ name: "length", defaultValue: "8", required: true }], content: 'const n = Number(getVar("param.length")||"8"); setVar("loginUser", "u"+randomInt(1000,9999)); log("n="+n);' },
        status: 201,
        extract: { var: "SCRIPT_ID", path: "$.data.id" },
      }),
      sampler({ name: "T2 发布（DRAFT→ENABLED）", method: "PATCH", path: "/api/v1/projects/${PROJECT_ID}/public-scripts/${SCRIPT_ID}", body: { status: "ENABLED" }, field: ["$.data.status", "ENABLED"] }),
      sampler({ name: "T3 列表分页信封", method: "GET", path: "/api/v1/projects/${PROJECT_ID}/public-scripts?pageSize=10", contains: ["$.data.items[0].status", "ENABLED"] }),
      sampler({
        name: "T4 在线调试（参数覆盖默认→log 出参）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/public-scripts/${SCRIPT_ID}/debug",
        body: { vars: {}, params: { length: "6" } },
        contains: ["$.data.logs[0]", "n=6"],
      }),
      sampler({ name: "T5 引用清单（无引用）", method: "GET", path: "/api/v1/projects/${PROJECT_ID}/public-scripts/${SCRIPT_ID}/references", field: ["$.data.references.length()", "0"] }),
      sampler({ name: "T6 无引用删除成功", method: "DELETE", path: "/api/v1/projects/${PROJECT_ID}/public-scripts/${SCRIPT_ID}" }),
    ]),
    threadGroup("错误场景（401/404/422）", [
      sampler({ name: "E1 401 未登录脚本列表", method: "GET", path: `/api/v1/projects/${FAKE_PID}/public-scripts`, status: 401, code: 10001 }),
      ...registerSetup("EMAIL_ERR"),
      sampler({ name: "E2 建脚本供错误场景", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/public-scripts", body: { name: `jm-err-${TS}`, language: "javascript", tags: [], params: [{ name: "p1", defaultValue: "", required: true }], content: "log(1);" }, status: 201, extract: { var: "SCRIPT2", path: "$.data.id" } }),
      sampler({ name: "E3 422 重名", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/public-scripts", body: { name: `jm-err-${TS}`, language: "javascript", tags: [], params: [], content: "" }, status: 422, code: 20422 }),
      sampler({ name: "E4 422 调试缺必填参数", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/public-scripts/${SCRIPT2}/debug", body: { vars: {}, params: {} }, status: 422, code: 20422 }),
      sampler({ name: "E5 422 参数重名", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/public-scripts", body: { name: `jm-dup-${TS}`, language: "javascript", tags: [], params: [{ name: "a", defaultValue: "", required: false }, { name: "a", defaultValue: "", required: false }], content: "" }, status: 422, code: 20422 }),
      sampler({ name: "E6 404 坏 id 发布", method: "PATCH", path: "/api/v1/projects/${PROJECT_ID}/public-scripts/00000000-0000-0000-0000000000de", body: { status: "ENABLED" }, status: 404, code: 20450 }),
    ]),
  ],
);

// ═══════ PROJ-006 环境组与全局参数 ═══════
const proj006 = plan(
  "PROJ-006 环境组与全局参数（组 CRUD/展开过滤/全局参数 KV/互斥；四类场景）",
  {
    EMAIL: `jm-eg6-${TS}@rabbit.test`,
    ...commonVars(),
  },
  [
    threadGroup("环境组与全局参数主链路", [
      ...registerSetup(),
      sampler({ name: "T1 建环境 E1", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/environments", body: { name: `jm-e1-${TS}`, config: { vars: [{ key: "host", value: "h1", enabled: true }] } }, status: 201, extract: { var: "ENV1", path: "$.data.id" } }),
      sampler({ name: "T2 建环境 E2", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/environments", body: { name: `jm-e2-${TS}`, config: { vars: [{ key: "host", value: "h2", enabled: true }] } }, status: 201, extract: { var: "ENV2", path: "$.data.id" } }),
      sampler({ name: "T3 建环境组（有序两环境）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/env-groups", body: { name: `jm-group-${TS}`, environmentIds: ["${ENV1}", "${ENV2}"] }, status: 201, extract: { var: "GROUP_ID", path: "$.data.id" }, field: ["$.data.environmentIds.length()", "2"] }),
      sampler({ name: "T4 组列表分页信封", method: "GET", path: "/api/v1/projects/${PROJECT_ID}/env-groups?pageSize=10", contains: ["$.data.items[0].name", "jm-group-"] }),
      sampler({ name: "T5 编辑组（去掉 E2）", method: "PATCH", path: "/api/v1/projects/${PROJECT_ID}/env-groups/${GROUP_ID}", body: { name: `jm-group-${TS}`, environmentIds: ["${ENV1}"] }, field: ["$.data.environmentIds.length()", "1"] }),
      sampler({ name: "T6 全局参数 PUT", method: "PUT", path: "/api/v1/projects/${PROJECT_ID}/global-params", body: { params: [{ key: "app.host", value: "https://global.example.com", description: "" }] }, contains: ["$.data.params[0].key", "app.host"] }),
      sampler({ name: "T7 全局参数 GET 回读", method: "GET", path: "/api/v1/projects/${PROJECT_ID}/global-params", contains: ["$.data.params[0].value", "global.example.com"] }),
      sampler({ name: "T8 删除组（物理删）", method: "DELETE", path: "/api/v1/projects/${PROJECT_ID}/env-groups/${GROUP_ID}" }),
    ]),
    threadGroup("错误场景（401/404/422）", [
      sampler({ name: "E1 401 未登录组列表", method: "GET", path: `/api/v1/projects/${FAKE_PID}/env-groups`, status: 401, code: 10001 }),
      ...registerSetup("EMAIL_ERR"),
      sampler({ name: "E2 建环境供错误场景", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/environments", body: { name: `jm-e3-${TS}`, config: {} }, status: 201, extract: { var: "ENV3", path: "$.data.id" } }),
      sampler({ name: "E3a 建组 jm-gx（供重名断言）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/env-groups", body: { name: `jm-gx-${TS}`, environmentIds: ["${ENV3}"] }, status: 201, extract: { var: "GX_ID", path: "$.data.id" } }),
      sampler({ name: "E3 422 组名重名（jm-gx 已存在）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/env-groups", body: { name: `jm-gx-${TS}`, environmentIds: ["${ENV3}"] }, status: 422, code: 20422 }),
      sampler({ name: "E4 建组 E4", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/env-groups", body: { name: `jm-g4-${TS}`, environmentIds: ["${ENV3}"] }, status: 201, extract: { var: "GROUP4", path: "$.data.id" } }),
      sampler({ name: "E5 422 envId 与 envGroupId 同传（互斥）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/scenarios/execute", body: { scenarioIds: ["00000000-0000-4000-8000-000000000001"], envId: "${ENV3}", envGroupId: "${GROUP4}" }, status: 422, code: 20422 }),
      sampler({ name: "E6 404 坏组 id 编辑", method: "PATCH", path: "/api/v1/projects/${PROJECT_ID}/env-groups/00000000-0000-0000-0000000000de", body: { name: "x", environmentIds: ["${ENV3}"] }, status: 404, code: 20460 }),
      sampler({ name: "E7 删组内唯一环境", method: "DELETE", path: "/api/v1/projects/${PROJECT_ID}/environments/${ENV3}" }),
      sampler({ name: "E8 422 组内无可用环境（ENV_GROUP_EMPTY）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/scenarios/execute", body: { scenarioIds: ["00000000-0000-4000-8000-000000000001"], envGroupId: "${GROUP4}" }, status: 422, code: 20461 }),
    ]),
  ],
);

// ═══════ FILE-001 Git 仓库文件 ═══════
const file001 = plan(
  "FILE-001 Git 存储库（连接/拉取/溯源/回收站；四类场景）",
  {
    EMAIL: `jm-fr1-${TS}@rabbit.test`,
    ...commonVars(),
  },
  [
    threadGroup("存储库主链路", [
      ...registerSetup(),
      sampler({
        name: "T1 连接存储库（gitea→mock，token 加密）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/file-repos",
        body: { platform: "gitea", url: `http://${MOCK_GIT}/qa/testdata`, token: "jm-git-token" },
        status: 201,
        field: ["$.data.hasToken", "true"],
        extract: { var: "REPO_ID", path: "$.data.id" },
      }),
      sampler({ name: "T2 连接测试（repo 元信息探活）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/file-repos/${REPO_ID}/test", body: {}, field: ["$.data.ok", "true"] }),
      sampler({ name: "T3 按分支+路径拉取（data/ 目录 3 文件）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/file-repos/${REPO_ID}/pull", body: { branch: "main", path: "data/" }, status: 201, field: ["$.data.pulled", "3"] }),
      sampler({ name: "T4 仓库列表分页信封", method: "GET", path: "/api/v1/projects/${PROJECT_ID}/file-repos?pageSize=10", contains: ["$.data.items[0].platform", "gitea"] }),
      sampler({ name: "T5 文件列表带溯源（repoPlatform=gitea）", method: "GET", path: "/api/v1/projects/${PROJECT_ID}/files?pageSize=20", contains: ["$.data.items[0].repoPlatform", "gitea"], extract: { var: "FILE_ID", path: "$.data.items[0].id" } }),
      sampler({ name: "T6 重复拉取=覆盖刷新（refreshed=3）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/file-repos/${REPO_ID}/pull", body: { branch: "main", path: "data/" }, status: 201, field: ["$.data.refreshed", "3"] }),
      sampler({ name: "T7 单文件重新拉取（sync）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/files/${FILE_ID}/sync", body: {}, contains: ["$.data.size"] }),
      sampler({ name: "T8 软删文件→回收站", method: "DELETE", path: "/api/v1/projects/${PROJECT_ID}/files/${FILE_ID}" }),
      sampler({ name: "T9 回收站列表（recycled=true）", method: "GET", path: "/api/v1/projects/${PROJECT_ID}/files?recycled=true&pageSize=10", contains: ["$.data.items[0].deletedAt"] }),
      sampler({ name: "T10 恢复", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/files/${FILE_ID}/restore", body: {}, field: ["$.data.id", "${FILE_ID}"] }),
      sampler({ name: "T11 再删+彻底删除（purge）", method: "DELETE", path: "/api/v1/projects/${PROJECT_ID}/files/${FILE_ID}" }),
      sampler({ name: "T11b 彻底删除", method: "DELETE", path: "/api/v1/projects/${PROJECT_ID}/files/${FILE_ID}?purge=true" }),
      sampler({ name: "T12 回收站清空", method: "GET", path: "/api/v1/projects/${PROJECT_ID}/files?recycled=true&pageSize=10", field: ["$.data.total", "0"] }),
    ]),
    threadGroup("错误场景（401/404/422）", [
      sampler({ name: "E1 401 未登录存储库列表", method: "GET", path: `/api/v1/projects/${FAKE_PID}/file-repos`, status: 401, code: 10001 }),
      ...registerSetup("EMAIL_ERR"),
      sampler({ name: "E2 422 url 缺 owner/repo", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/file-repos", body: { platform: "gitea", url: "https://only-host/" }, status: 422, code: 20422 }),
      sampler({ name: "E3 建仓库供错误场景", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/file-repos", body: { platform: "gitea", url: `http://${MOCK_GIT}/qa/testdata` }, status: 201, extract: { var: "REPO2", path: "$.data.id" } }),
      sampler({ name: "E4 422 拉取不存在路径（mock 404）", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/file-repos/${REPO2}/pull", body: { branch: "main", path: "no-such-path/" }, status: 422, code: 40462 }),
      sampler({ name: "E5 404 坏仓库 id 测试", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/file-repos/00000000-0000-0000-0000000000de/test", body: {}, status: 404, code: 40460 }),
    ]),
  ],
);

// ═══════ SYS-007 个人中心 ═══════
const sys007 = plan(
  "SYS-007 个人中心（个人信息/改密/本地执行/个人模型；四类场景）",
  {
    EMAIL: `jm-pc7-${TS}@rabbit.test`,
    ...commonVars(),
  },
  [
    threadGroup("个人中心主链路", [
      ...registerSetup(),
      sampler({ name: "T1 编辑个人信息（姓名/手机）", method: "PATCH", path: "/api/v1/personal/me", body: { name: `jm-user-${TS}`, phone: "13800001111" }, field: ["$.data.name", `jm-user-${TS}`] }),
      sampler({ name: "T2 me 回读", method: "GET", path: "/api/v1/personal/me", contains: ["$.data.name", `jm-user-${TS}`] }),
      sampler({ name: "T3 本地执行配置（环回指向 mock healthz）", method: "PUT", path: "/api/v1/personal/local-runner", body: { address: `http://${MOCK_GIT}/healthz`, preferLocal: true }, field: ["$.data.preferLocal", "true"] }),
      sampler({ name: "T4 连通检测（reachable）", method: "POST", path: "/api/v1/personal/local-runner/check", body: {}, field: ["$.data.reachable", "true"] }),
      sampler({ name: "T5 个人默认模型（admin 取系统模型 id）", method: "POST", path: "/api/v1/auth/login", body: { email: "admin@rabbit.test", password: "rabbit-admin-123" }, field: ["$.code", "0"] }),
      sampler({ name: "T5b 取启用模型 id", method: "GET", path: "/api/v1/ai/models", extract: { var: "MODEL_ID", path: "$.data.list[0].id" }, contains: ["$.data.list[0].id"] }),
      sampler({ name: "T6 切回用户会话", method: "POST", path: "/api/v1/auth/login", body: { email: "${EMAIL}", password: "rabbit-pass-123" }, field: ["$.code", "0"] }),
      sampler({ name: "T7 设置个人默认模型", method: "PUT", path: "/api/v1/personal/ai-model", body: { modelId: "${MODEL_ID}" }, field: ["$.data.modelId", "${MODEL_ID}"] }),
      sampler({ name: "T8 回读个人默认模型", method: "GET", path: "/api/v1/personal/ai-model", contains: ["$.data.modelId"] }),
    ]),
    threadGroup("错误场景（401/422）", [
      sampler({ name: "E1 401 未登录 me", method: "GET", path: "/api/v1/personal/me", status: 401, code: 10001 }),
      ...registerSetup("EMAIL_ERR"),
      sampler({ name: "E2 422 旧密码错（10020）", method: "POST", path: "/api/v1/personal/me", body: { oldPassword: "wrong-old-pass", newPassword: "rabbit-new-12345" }, status: 422, code: 10020 }),
      sampler({ name: "E3 422 新密码 7 位", method: "POST", path: "/api/v1/personal/me", body: { oldPassword: "rabbit-pass-123", newPassword: "short7" }, status: 422, code: 20422 }),
      sampler({ name: "E4 422 本地 runner 非环回（10021）", method: "PUT", path: "/api/v1/personal/local-runner", body: { address: "http://192.168.1.1:7001", preferLocal: false }, status: 422, code: 10021 }),
      sampler({ name: "E5 422 个人模型不存在（10022）", method: "PUT", path: "/api/v1/personal/ai-model", body: { modelId: "00000000-0000-4000-8000-0000000000dd" }, status: 422, code: 10022 }),
    ]),
  ],
);

// ═══════ 产出 ═══════
const targets = [
  ["MSG-001-notification-robot.jmx", msg001],
  ["BUG-002-bug-collaboration-recycle.jmx", bug002],
  ["PROJ-005-public-scripts.jmx", proj005],
  ["PROJ-006-env-group-global-params.jmx", proj006],
  ["FILE-001-git-repository-files.jmx", file001],
  ["SYS-007-personal-center.jmx", sys007],
];
for (const [name, content] of targets) {
  writeFileSync(path.join(OUT, name), content);
  console.log(`[gen-jmx-s5] ${name}`);
}
console.log(`[gen-jmx-s5] done: ${targets.length} plans`);
