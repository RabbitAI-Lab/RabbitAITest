#!/usr/bin/env node
/**
 * Sprint 7 JMeter 用例生成器：从声明式定义生成 tests/api/{AI-001..005}-*.jmx。
 * 规范 rules/testing §2：四类场景（正常/401·403·404/422/分页信封）×四项断言。
 * AI 栈前提：api-test-stack.sh 注入 AI_ALLOW_PRIVATE_BASEURL=1（仅豁免环回——mock 供应商 127.0.0.1:4000；
 * 私网/元地址仍被拒，SSRF 422 用例真实生效）。
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
  // SSE 等非信封响应（noEnvelope）无 $.code 可断，跳过
  if (!d.noEnvelope) {
    assertions.push(`
          <JSONPathAssertion guiclass="JSONPathAssertionGui" testclass="JSONPathAssertion" testname="code=${code}">
            <stringProp name="JSON_PATH">$.code</stringProp>
            <stringProp name="EXPECTED_VALUE">${code}</stringProp>
            <boolProp name="JSONVALIDATION">true</boolProp>
          </JSONPathAssertion>
          <hashTree/>`);
  }
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
  // 任意响应体文本断言（SSE 采样器：text/event-stream 非信封，无 $.code）
  if (d.rawContains) {
    assertions.push(`
          <ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="body contains ${esc(d.rawContains)}">
            <collectionProp name="Asserion.test_strings"><stringProp name="49586">${esc(d.rawContains)}</stringProp></collectionProp>
            <stringProp name="Assertion.test_field">Assertion.response_data</stringProp>
            <intProp name="Assertion.test_type">2</intProp>
          </ResponseAssertion>
          <hashTree/>`);
  }
  if (d.contentType) {
    assertions.push(`
          <ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="header content-type 含 ${esc(d.contentType)}">
            <collectionProp name="Asserion.test_strings"><stringProp name="49586">${esc(d.contentType)}</stringProp></collectionProp>
            <stringProp name="Assertion.test_field">Assertion.response_headers</stringProp>
            <intProp name="Assertion.test_type">16</intProp>
          </ResponseAssertion>
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
const TS = "${TS}";
const FAKE_PID = "00000000-0000-0000-0000-000000000009";
const MOCK_BASE = "${MOCK_BASE}"; // 注入值须含 /ai 前缀（mock 路由 /ai/chat/completions）
/** mock 供应商 API Key 占位（非可用凭据形态，仅为过 schema min 约束） */
const MOCK_KEY = "mock-not-a-real-key";

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

/** 系统管理员登录（AI-001 系统级端点；种子 admin@rabbit.test）。 */
const adminLoginSetup = () => [
  sampler({
    name: "T0 种子管理员登录",
    method: "POST",
    path: "/api/v1/auth/login",
    body: { email: "admin@rabbit.test", password: "rabbit-admin-123" },
    field: ["$.code", "0"],
  }),
  sampler({
    name: "T0.1 种子 mock 模型在列（掩码脱敏）",
    method: "GET",
    path: "/api/v1/system/ai-models",
    // JSONPathAssertion 恒按正则匹配：sk-**** 为非法正则（静默失败）——断前缀 sk-（正则安全）
    contains: ["$.data.list[0].apiKeyMasked", "sk-"],
    extract: { var: "SEED_MODEL_ID", path: "$.data.list[0].id" },
  }),
  sampler({
    name: "T0.2 创建 mock 模型（环回放行）",
    method: "POST",
    path: "/api/v1/system/ai-models",
    body: { name: `jm-${TS}`, provider: "zhipu", baseUrl: MOCK_BASE, model: "mock-e2e-model", apiKey: MOCK_KEY, enabled: true },
    status: 201,
    extract: { var: "MODEL_ID", path: "$.data.id" },
  }),
];

const unauthGroup = (s) => threadGroup("未登录（无 Cookie）", [sampler(s)], false);

// ═══════ AI-001 模型网关 ═══════
const ai001 = plan(
  "AI-001 模型网关（CRUD/默认/连接测试/SSRF 守卫/掩码脱敏）",
  {
    EMAIL: `jm-ai1-\${__time(yyyyMMddHHmmss)}-\${__threadNum}@rabbit.test`,
    TS: "${__time(yyyyMMddHHmmss)}",
    // mock 供应商基地址（run-api-tests -JMOCK_BASE 注入；TestPlan 变量定义时求值 __P——body 内联 __P 不替换的坑）
    MOCK_BASE: "${__P(MOCK_BASE,http://127.0.0.1:4000/ai)}",
  },
  [
    threadGroup("模型管理主链路", [
      ...adminLoginSetup(),
      sampler({ name: "T1 列表（掩码脱敏，无明文 key）", method: "GET", path: "/api/v1/system/ai-models", contains: ["$.data.list[0].apiKeyMasked", "sk-"] }),
      sampler({ name: "T2 连接测试（mock 探测分支 pong）", method: "POST", path: "/api/v1/system/ai-models/${MODEL_ID}/test", field: ["$.data.echo", "pong"] }),
      sampler({ name: "T3 设为默认", method: "PUT", path: "/api/v1/system/ai-models/${MODEL_ID}/default", body: {} }),
      sampler({
        name: "T4 编辑（key 留空=不改）",
        method: "PUT",
        path: "/api/v1/system/ai-models/${MODEL_ID}",
        body: { name: `jm-${TS}-edit`, provider: "zhipu", baseUrl: MOCK_BASE, model: "mock-e2e-model", enabled: true },
      }),
      sampler({ name: "T5 编辑后连接仍通", method: "POST", path: "/api/v1/system/ai-models/${MODEL_ID}/test", field: ["$.data.ok", "true"] }),
      sampler({ name: "T6 启用模型下拉（登录可见）", method: "GET", path: "/api/v1/ai/models", contains: ["$.data.list[0].model", "mock-e2e-model"] }),
      sampler({
        name: "T7 422 provider 非法",
        method: "POST",
        path: "/api/v1/system/ai-models",
        body: { name: "bad", provider: "anthropic", baseUrl: MOCK_BASE, model: "m", apiKey: MOCK_KEY, enabled: true },
        status: 422,
        code: 20422,
      }),
      sampler({
        name: "T8 422 baseUrl 云元数据（守卫恒拦，测试开关不豁免）",
        method: "POST",
        path: "/api/v1/system/ai-models",
        body: { name: "ssrf", provider: "zhipu", baseUrl: "http://169.254.169.254/latest/meta-data", model: "m", apiKey: MOCK_KEY, enabled: true },
        status: 422,
        code: 70422,
      }),
      sampler({
        name: "T9 422 baseUrl 私网段",
        method: "POST",
        path: "/api/v1/system/ai-models",
        body: { name: "ssrf2", provider: "zhipu", baseUrl: "http://10.1.2.3/v1", model: "m", apiKey: MOCK_KEY, enabled: true },
        status: 422,
        code: 70422,
      }),
      sampler({ name: "T10 404 坏 id 测试连接", method: "POST", path: "/api/v1/system/ai-models/00000000-0000-0000-0000-00000000dead/test", status: 404, code: 70404 }),
      sampler({ name: "T11 删除", method: "DELETE", path: "/api/v1/system/ai-models/${MODEL_ID}" }),
    ]),
    unauthGroup({ name: "U1 401 未登录列表", method: "GET", path: "/api/v1/system/ai-models", status: 401, code: 10001 }),
  ],
);

// ═══════ AI-002 功能用例生成 ═══════
const ai002 = plan(
  "AI-002 功能用例 AI 生成（mock 草稿/留痕/校验四类）",
  {
    EMAIL: `jm-ai2-\${__time(yyyyMMddHHmmss)}-\${__threadNum}@rabbit.test`,
    EMAIL2: `jm-ai2b-\${__time(yyyyMMddHHmmss)}-\${__threadNum}@rabbit.test`,
    TS: "${__time(yyyyMMddHHmmss)}",
    // mock 供应商基地址（run-api-tests -JMOCK_BASE 注入；TestPlan 变量定义时求值 __P——body 内联 __P 不替换的坑）
    MOCK_BASE: "${__P(MOCK_BASE,http://127.0.0.1:4000/ai)}",
  },
  [
    threadGroup("用例生成主链路", [
      ...registerSetup(),
      sampler({
        name: "T1 生成草稿（mock 2 条确定性）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/ai/generate/cases",
        body: { requirement: "用户连续输错密码 5 次应锁定 30 分钟" },
        field: ["$.data.drafts[0].name", "密码错误 5 次后锁定账户"],
        contains: ["$.data.drafts[1].name", "锁定"],
        duration: 8000,
      }),
      sampler({ name: "T1.1 草稿字段抽查", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/ai/generate/cases", body: { requirement: "购物车结算金额计算" }, contains: ["$.data.drafts[0].name", "锁定"] }),
      sampler({ name: "T2 生成留痕列表", method: "GET", path: "/api/v1/projects/${PROJECT_ID}/ai/gen-records", field: ["$.data.list[0].generatedCount", "2"] }),
      sampler({ name: "T3 422 需求为空", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/ai/generate/cases", body: { requirement: "" }, status: 422, code: 20422 }),
      sampler({ name: "T4 422 需求超长", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/ai/generate/cases", body: { requirement: "x".repeat(8001) }, status: 422, code: 20422 }),
      sampler({ name: "T5 404 坏 modelId", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/ai/generate/cases", body: { requirement: "r", modelId: "00000000-0000-0000-0000-00000000dead" }, status: 404, code: 70404 }),
    ]),
    unauthGroup({ name: "U1 401 未登录生成", method: "POST", path: `/api/v1/projects/${FAKE_PID}/ai/generate/cases`, body: { requirement: "r" }, status: 401, code: 10001 }),
    threadGroup(
      "404 越域项目（防枚举）",
      [
        ...registerSetup("EMAIL2"),
        sampler({ name: "F1 404 非成员项目生成", method: "POST", path: `/api/v1/projects/${FAKE_PID}/ai/generate/cases`, body: { requirement: "r" }, status: 404, code: 20404 }),
      ],
    ),
  ],
);

// ═══════ AI-003 接口用例生成 ═══════
const ai003 = plan(
  "AI-003 接口用例 AI 生成（单条按定义/OpenAPI 批量）",
  {
    EMAIL: `jm-ai3-\${__time(yyyyMMddHHmmss)}-\${__threadNum}@rabbit.test`,
    TS: "${__time(yyyyMMddHHmmss)}",
    // mock 供应商基地址（run-api-tests -JMOCK_BASE 注入；TestPlan 变量定义时求值 __P——body 内联 __P 不替换的坑）
    MOCK_BASE: "${__P(MOCK_BASE,http://127.0.0.1:4000/ai)}",
  },
  [
    threadGroup("接口用例生成主链路", [
      ...registerSetup(),
      sampler({
        name: "T0.3a 取默认模块（scene=api）",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/modules?scene=api",
        contains: ["$.data.items[0].id", "-"],
        extract: { var: "API_MODULE_ID", path: "$.data.items[0].id" },
      }),
      sampler({
        name: "T0.3b 建接口定义",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/apis",
        body: { moduleId: "${API_MODULE_ID}", name: "创建订单", status: "DEBUG", request: { spec: { method: "POST", url: "/api/orders", headers: [], query: [], body: { kind: "raw_json", content: "" }, auth: { kind: "none" }, timeoutMs: 60000, followRedirects: false, skipPre: false, skipPost: false }, asserts: [], pre: [], post: [], extracts: [] } },
        status: 201,
        extract: { var: "API_ID", path: "$.data.id" },
      }),
      sampler({
        name: "T1 单条生成（mock 1 条含 status 断言）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/ai/generate/api-cases",
        body: { apiId: "${API_ID}" },
        contains: ["$.data.drafts[0].name", "创建订单"],
        duration: 8000,
      }),
      sampler({
        name: "T2 批量生成（2 接口 OpenAPI）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/ai/generate/api-cases/batch",
        body: { openapiDoc: '{"openapi":"3.0.0","info":{"title":"订单"},"paths":{"/api/orders":{"post":{"summary":"创建订单"}},"/api/orders/{id}":{"get":{"summary":"查询订单"}}}}' },
        contains: ["$.data.apis[1].path", "/api/orders/{id}"],
        duration: 15000,
      }),
      sampler({ name: "T3 422 非法 OpenAPI 文档", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/ai/generate/api-cases/batch", body: { openapiDoc: "not-json" }, status: 422, code: 70503 }),
      sampler({ name: "T4 404 坏 apiId", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/ai/generate/api-cases", body: { apiId: "00000000-0000-0000-0000-00000000dead" }, status: 404, code: 40414 }),
      sampler({ name: "T5 422 空 apiId", method: "POST", path: "/api/v1/projects/${PROJECT_ID}/ai/generate/api-cases", body: { apiId: "" }, status: 422, code: 20422 }),
    ]),
    unauthGroup({ name: "U1 401 未登录批量生成", method: "POST", path: `/api/v1/projects/${FAKE_PID}/ai/generate/api-cases/batch`, body: { openapiDoc: "{}" }, status: 401, code: 10001 }),
  ],
);

// ═══════ AI-004 助手会话与流式对话 ═══════
const ai004 = plan(
  "AI-004 智能助手（会话 CRUD/SSE 流式/上下文窗口/隔离）",
  {
    EMAIL: `jm-ai4-\${__time(yyyyMMddHHmmss)}-\${__threadNum}@rabbit.test`,
    EMAIL2: `jm-ai4b-\${__time(yyyyMMddHHmmss)}-\${__threadNum}@rabbit.test`,
    TS: "${__time(yyyyMMddHHmmss)}",
    // mock 供应商基地址（run-api-tests -JMOCK_BASE 注入；TestPlan 变量定义时求值 __P——body 内联 __P 不替换的坑）
    MOCK_BASE: "${__P(MOCK_BASE,http://127.0.0.1:4000/ai)}",
  },
  [
    threadGroup("会话与对话主链路", [
      ...registerSetup(),
      sampler({ name: "T1 新建会话", method: "POST", path: "/api/v1/ai/conversations", body: { title: "锁定的用例设计" }, status: 201, extract: { var: "CONV_ID", path: "$.data.id" } }),
      sampler({ name: "T2 会话列表（本人）", method: "GET", path: "/api/v1/ai/conversations", field: ["$.data.list[0].title", "锁定的用例设计"] }),
      sampler({ name: "T3 重命名", method: "PUT", path: "/api/v1/ai/conversations/${CONV_ID}", body: { title: "重命名后的会话" } }),
      sampler({
        name: "T4 SSE 流式对话（mock 分片聚合）",
        method: "POST",
        path: "/api/v1/ai/chat",
        body: { conversationId: "${CONV_ID}", content: "密码锁定策略怎么设计用例" },
        noEnvelope: true,
        contentType: "text/event-stream",
        rawContains: '"type":"delta"',
        duration: 8000,
      }),
      sampler({ name: "T5 历史消息（user+assistant 各一+完整文本）", method: "GET", path: "/api/v1/ai/conversations/${CONV_ID}/messages", contains: ["$.data.list[1].role", "assistant"] }),
      sampler({ name: "T5.1 助手消息完整落库（聚合无分片）", method: "GET", path: "/api/v1/ai/conversations/${CONV_ID}/messages", contains: ["$.data.list[1].text", "边界值"] }),
      sampler({ name: "T6 删除会话（软删）", method: "DELETE", path: "/api/v1/ai/conversations/${CONV_ID}" }),
      sampler({ name: "T7 删除后消息 404", method: "GET", path: "/api/v1/ai/conversations/${CONV_ID}/messages", status: 404, code: 70414 }),
      sampler({ name: "T8 422 content 为空对话", method: "POST", path: "/api/v1/ai/chat", body: { content: "" }, status: 422, code: 20422 }),
    ]),
    unauthGroup({ name: "U1 401 未登录会话列表", method: "GET", path: "/api/v1/ai/conversations", status: 401, code: 10001 }),
    threadGroup("会话个人隔离（防枚举）", [
      ...registerSetup("EMAIL2"),
      sampler({ name: "F1 404 他人会话消息", method: "GET", path: "/api/v1/ai/conversations/00000000-0000-0000-0000-00000000c0de/messages", status: 404, code: 70414 }),
    ]),
  ],
);

// ═══════ AI-005 提示词模板 ═══════
const ai005 = plan(
  "AI-005 提示词自定义（CRUD/占位符校验/默认语义）",
  {
    EMAIL: `jm-ai5-\${__time(yyyyMMddHHmmss)}-\${__threadNum}@rabbit.test`,
    TS: "${__time(yyyyMMddHHmmss)}",
    // mock 供应商基地址（run-api-tests -JMOCK_BASE 注入；TestPlan 变量定义时求值 __P——body 内联 __P 不替换的坑）
    MOCK_BASE: "${__P(MOCK_BASE,http://127.0.0.1:4000/ai)}",
  },
  [
    threadGroup("模板主链路", [
      ...registerSetup(),
      sampler({
        name: "T1 新建模板（合法占位符）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/ai/prompt-templates",
        body: { name: `边界值侧重-${TS}`, scene: "case_gen", template: "基于 {{requirement}} 用 {{design_method}} 生成，模块 {{module}}", designMethod: "边界值分析", isDefault: true, enabled: true },
        status: 201,
        extract: { var: "PROMPT_ID", path: "$.data.id" },
      }),
      sampler({ name: "T2 列表信封", method: "GET", path: "/api/v1/projects/${PROJECT_ID}/ai/prompt-templates", field: ["$.data.list[0].isDefault", "true"] }),
      sampler({
        name: "T3 新建第二模板并设默认（默认唯一）",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/ai/prompt-templates",
        body: { name: `场景法-${TS}`, scene: "case_gen", template: "用场景法覆盖 {{requirement}}", designMethod: "场景法", isDefault: true, enabled: true },
        status: 201,
        extract: { var: "PROMPT2_ID", path: "$.data.id" },
      }),
      sampler({ name: "T4 旧默认被清（新默认唯一）", method: "GET", path: "/api/v1/projects/${PROJECT_ID}/ai/prompt-templates", field: ["$.data.list[0].id", "${PROMPT2_ID}"] }),
      sampler({
        name: "T5 422 未知占位符",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/ai/prompt-templates",
        body: { name: "bad", scene: "case_gen", template: "{{requirment}} 拼写错误", isDefault: false, enabled: true },
        status: 422,
        code: 70505,
      }),
      sampler({
        name: "T6 422 名称重复",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/ai/prompt-templates",
        body: { name: `边界值侧重-${TS}`, scene: "case_gen", template: "{{requirement}}", isDefault: false, enabled: true },
        status: 422,
        code: 70504,
      }),
      sampler({ name: "T7 404 坏 id 更新", method: "PUT", path: "/api/v1/projects/${PROJECT_ID}/ai/prompt-templates/00000000-0000-0000-0000-00000000dead", body: { name: "x", scene: "case_gen", template: "{{requirement}}", isDefault: false, enabled: true }, status: 404, code: 70424 }),
      sampler({ name: "T8 删除", method: "DELETE", path: "/api/v1/projects/${PROJECT_ID}/ai/prompt-templates/${PROMPT2_ID}" }),
    ]),
    unauthGroup({ name: "U1 401 未登录模板列表", method: "GET", path: `/api/v1/projects/${FAKE_PID}/ai/prompt-templates`, status: 401, code: 10001 }),
  ],
);

// ═══════ 产出 ═══════
const targets = [
  ["AI-001-model-gateway.jmx", ai001],
  ["AI-002-case-generation.jmx", ai002],
  ["AI-003-api-case-generation.jmx", ai003],
  ["AI-004-ai-assistant.jmx", ai004],
  ["AI-005-prompt-customization.jmx", ai005],
];
for (const [name, content] of targets) {
  writeFileSync(path.join(OUT, name), content);
  console.log(`[gen-jmx-s7] ${name}`);
}
console.log(`[gen-jmx-s7] done: ${targets.length} plans`);
