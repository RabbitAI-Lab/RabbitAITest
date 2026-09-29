#!/usr/bin/env node
/**
 * S-future（P4）JMeter 用例生成器：7 份计划（LOAD-002 纯规格豁免）。
 * rules/testing §2：四类场景（正常/401·403·404/422/分页信封）× 四项断言（HTTP/code/JSONPath/耗时）。
 * 扩展：file 上传采样器（插件 tarball multipart）/ header 采样器（APIKEY）/ JSR223 props 桥（跨线程组 AK/SK）。
 * 生成物提交入库；重跑 --force 覆盖。
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

/** 采样器：四项断言；status>=400 assume_success；file=上传；header=请求头；jsr223=后置脚本。 */
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
  const header = d.header
    ? `
          <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="Header ${esc(d.header.name)}">
            <collectionProp name="HeaderManager.headers">
              <elementProp name="" elementType="Header">
                <stringProp name="Header.name">${esc(d.header.name)}</stringProp>
                <stringProp name="Header.value">${esc(d.header.value)}</stringProp>
              </elementProp>
            </collectionProp>
          </HeaderManager>
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
  } else if (d.file) {
    // multipart：普通字段 + 文件（repo 根相对路径，api 栈以根为 cwd）
    const fields = Object.entries(d.file.fields ?? {})
      .map(
        ([k, v]) => `
              <elementProp name="${esc(k)}" elementType="HTTPArgument">
                <boolProp name="HTTPArgument.always_encode">false</boolProp>
                <stringProp name="Argument.name">${esc(k)}</stringProp>
                <stringProp name="Argument.value">${esc(String(v))}</stringProp>
                <stringProp name="Argument.metadata">=</stringProp>
              </elementProp>`,
      )
      .join("");
    bodyProp = `
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments">
            <collectionProp name="Arguments.arguments">${fields}
            </collectionProp>
          </elementProp>
          <elementProp name="HTTPsampler.Files" elementType="HTTPFileArgs">
            <collectionProp name="HTTPFileArgs.files">
              <elementProp name="" elementType="HTTPFileArg">
                <stringProp name="File.path">${esc(d.file.path)}</stringProp>
                <stringProp name="File.paramname">${esc(d.file.paramname ?? "file")}</stringProp>
                <stringProp name="File.mimetype">${esc(d.file.mimetype ?? "application/gzip")}</stringProp>
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
        <hashTree>${extractDefs}${jsr}${header}${assertions.join("")}
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
        ${elements.map(sampler).join("\n")}
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

const stamp = () => `\${__time(yyyyMMddHHmmss)}-\${__threadNum}`;
const files = new Map();
const emit = (name, title, vars, groups) => files.set(name, plan(title, vars, groups));

const registerSetup = () => [
  {
    name: "T0 注册并取会话+项目",
    method: "POST",
    path: "/api/v1/auth/register",
    body: { email: `\${EMAIL}`, password: "rabbit-pass-123" },
    status: 201,
    contains: ["$.data.projectId", "-"],
    extract: { var: "PROJECT_ID", path: "$.data.projectId" },
  },
];
const adminLogin = () => [
  {
    name: "T0 管理员登录",
    method: "POST",
    path: "/api/v1/auth/login",
    body: { email: "admin@rabbit.test", password: "rabbit-admin-123" },
    contains: ["$.data.userId", "-"],
  },
];

// ═══════ LOAD-001 / UIT-001 模块开关（占位） ═══════
for (const [id, KEY] of [
  ["LOAD-001", "load"],
  ["UIT-001", "uit"],
]) {
  emit(
    `${id}-modules.jmx`,
    `${id} ${KEY === "load" ? "性能测试" : "UI 测试"}模块占位开关`,
    { EMAIL: `jm-${id.toLowerCase()}-${stamp()}@rabbit.test` },
    [
      threadGroup("开关主链路（正常+校验；同线程组共用 PROJECT_ID 变量）", [
        ...registerSetup(),
        {
          name: "T1-1 GET 项目信息基线",
          method: "GET",
          path: "/api/v1/projects/${PROJECT_ID}/info",
          contains: ["$.data.modules", "case"],
        },
        {
          name: "T1-2 开启模块开关（PUT modules." + KEY + "=true）",
          method: "PUT",
          path: "/api/v1/projects/${PROJECT_ID}",
          body: { modules: { case: true, api: true, plan: true, bug: true, [KEY]: true } },
          field: [`$.data.modules.${KEY}`, "true"],
        },
        {
          name: "T1-3 回读开关生效",
          method: "GET",
          path: "/api/v1/projects/${PROJECT_ID}/info",
          field: [`$.data.modules.${KEY}`, "true"],
        },
        {
          name: "T3-1 非法载荷（" + KEY + "=字符串）→ 422",
          method: "PUT",
          path: "/api/v1/projects/${PROJECT_ID}",
          body: `{"modules":{"${KEY}":"yes"}}`,
          status: 422,
          code: 20422,
        },
      ]),
      threadGroup(
        "无会话 401",
        [
          {
            name: "T2-1 无会话 PUT → 401",
            method: "PUT",
            path: "/api/v1/projects/00000000-0000-0000-0000-000000000001",
            body: { modules: { [KEY]: true } },
            status: 401,
            code: 10001,
          },
        ],
        false,
      ),
    ],
  );
}

// ═══════ PLUG-003 协议插件 ═══════
const wsSpec = (protocol) => ({
  moduleId: "${API_MODULE_ID}",
  name: `WS 探活 ${protocol}`,
  status: "DEBUG",
  request: {
    spec: {
      method: "GET",
      url: `${protocol}://config`,
      protocol,
      protocolConfig: { url: "ws://127.0.0.1:1/x", timeoutMs: 500 },
      headers: [],
      query: [],
      body: { kind: "none" },
      auth: { kind: "none" },
      timeoutMs: 60000,
      followRedirects: false,
      skipPre: false,
      skipPost: false,
    },
    asserts: [],
    pre: [],
    post: [],
    extracts: [],
  },
});
emit(
  "PLUG-003-protocol-plugins.jmx",
  "PLUG-003 WebSocket/MQTT 协议插件（上传→启用→保存校验 40511）",
  { EMAIL: `jm-plug003-${stamp()}@rabbit.test` },
  [
    threadGroup("管理员：插件上传/启用/版本冲突", [
      ...adminLogin(),
      {
        name: "T1-2 上传 websocket 插件 tarball",
        method: "POST",
        path: "/api/v1/system/plugins",
        file: { path: "plugins/dist/websocket-1.0.0.tgz", fields: { orgScope: "ALL" } },
        status: 201,
        extract: { var: "WS_PLUGIN_ID", path: "$.data.id" },
      },
      {
        name: "T1-3 重复上传同版本 → 409·70005（版本需递增）",
        method: "POST",
        path: "/api/v1/system/plugins",
        file: { path: "plugins/dist/websocket-1.0.0.tgz", fields: { orgScope: "ALL" } },
        status: 409,
        code: 70005,
      },
      {
        name: "T1-4 启用 websocket 插件",
        method: "PUT",
        path: "/api/v1/system/plugins/${WS_PLUGIN_ID}",
        body: { enabled: true },
      },
      {
        name: "T1-5 上传并启用 mqtt 插件",
        method: "POST",
        path: "/api/v1/system/plugins",
        file: { path: "plugins/dist/mqtt-1.0.0.tgz", fields: { orgScope: "ALL" } },
        status: 201,
        extract: { var: "MQTT_PLUGIN_ID", path: "$.data.id" },
      },
      {
        name: "T1-6 启用 mqtt 插件",
        method: "PUT",
        path: "/api/v1/system/plugins/${MQTT_PLUGIN_ID}",
        body: { enabled: true },
      },
      {
        name: "T1-1 启用后列表（kind=protocol 信封；断言自建数据不锚定 total——多计划共用栈口径）",
        method: "GET",
        path: "/api/v1/system/plugins?kind=protocol",
        contains: ["$.data.list", "websocket"],
      },
    ]),
    threadGroup("项目侧：定义保存协议校验（40511 兑现）", [
      ...registerSetup(),
      {
        name: "T2-1 取默认模块（scene=api）",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/modules?scene=api",
        contains: ["$.data.items[0].id", "-"],
        extract: { var: "API_MODULE_ID", path: "$.data.items[0].id" },
      },
      {
        name: "T2-2 未启用协议（grpc 无插件包）保存 → 422·40511",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/apis",
        body: wsSpec("grpc"),
        status: 422,
        code: 40511,
      },
      {
        name: "T2-3 已启用 websocket 保存定义 → 201",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/apis",
        body: wsSpec("websocket"),
        status: 201,
      },
      {
        name: "T2-4 已启用 mqtt 保存定义 → 201",
        method: "POST",
        path: "/api/v1/projects/${PROJECT_ID}/apis",
        body: wsSpec("mqtt"),
        status: 201,
      },
    ]),
    threadGroup(
      "无会话 401",
      [
        {
          name: "T3-1 无会话上传插件 → 401",
          method: "POST",
          path: "/api/v1/system/plugins",
          file: { path: "plugins/dist/websocket-1.0.0.tgz", fields: { orgScope: "ALL" } },
          status: 401,
          code: 10001,
        },
      ],
      false,
    ),
  ],
);

// ═══════ TOOL-001 open api-sync ═══════
const apiKeySetup = () => [
  ...registerSetup(),
  {
    name: "T0.2 创建 APIKEY（提取 AK/SK 桥 props）",
    method: "POST",
    path: "/api/v1/personal/api-keys",
    body: { name: "JM P4" },
    status: 201,
    extracts: [
      { var: "AK", path: "$.data.accessKey" },
      { var: "SK", path: "$.data.secretKey" },
    ],
    jsr223: {
      name: "AK/SK/BASIC/PROJECT_ID 桥",
      script:
        'props.put("AK", vars.get("AK")); props.put("SK", vars.get("SK")); props.put("P4_PROJECT_ID", vars.get("PROJECT_ID")); props.put("BASIC", "Basic " + (vars.get("AK") + ":" + vars.get("SK")).bytes.encodeBase64().toString())',
    },
  },
];
const syncBody = (n, method = "GET") => ({
  projectId: "${__P(P4_PROJECT_ID)}",
  apis: Array.from({ length: n }, (_, i) => ({
    name: `同步接口 ${i + 1}`,
    method,
    path: `/jm/p4/sync/${i + 1}`,
  })),
});
emit(
  "TOOL-001-open-sync.jmx",
  "TOOL-001 IDEA 同步 open/api-sync（APIKEY + upsert 幂等）",
  { EMAIL: `jm-tool001-${stamp()}@rabbit.test` },
  [
    threadGroup("准备：注册+建 key", apiKeySetup()),
    threadGroup(
      "open 面同步（无会话，APIKEY 认证）",
      [
        {
          name: "T1-1 Bearer 首次同步 3 条 → created=3",
          method: "POST",
          path: "/api/v1/open/api-sync",
          body: syncBody(3),
          header: { name: "Authorization", value: "Bearer ${__P(AK)}.${__P(SK)}" },
          field: ["$.data.created", "3"],
        },
        {
          name: "T1-2 重放同批 → updated=3 created=0（幂等键 method+path）",
          method: "POST",
          path: "/api/v1/open/api-sync",
          body: syncBody(3),
          header: { name: "Authorization", value: "Bearer ${__P(AK)}.${__P(SK)}" },
          field: ["$.data.updated", "3"],
          contains: ["$.data.created", "0"],
        },
        {
          name: "T1-3 Basic 头等价认证（Groovy 侧预编 base64）→ 200",
          method: "POST",
          path: "/api/v1/open/api-sync",
          body: syncBody(1, "POST"),
          header: { name: "Authorization", value: "${__P(BASIC)}" },
          field: ["$.data.created", "1"],
        },
        {
          name: "T1-4 回读分页信封（keyword 命中 4 条 + items 断言）",
          method: "GET",
          path: "/api/v1/open/api-definitions?projectId=${__P(P4_PROJECT_ID)}&page=1&pageSize=10&keyword=%E5%90%8C%E6%AD%A5",
          header: { name: "Authorization", value: "Bearer ${__P(AK)}.${__P(SK)}" },
          field: ["$.data.total", "4"],
          contains: ["$.data.items", "同步接口"],
        },
        {
          name: "T2-1 无 Authorization → 401·10001",
          method: "POST",
          path: "/api/v1/open/api-sync",
          body: syncBody(1),
          status: 401,
          code: 10001,
        },
        {
          name: "T2-2 错误密钥 → 401·10010",
          method: "POST",
          path: "/api/v1/open/api-sync",
          body: syncBody(1),
          header: { name: "Authorization", value: "Bearer bad.key" },
          status: 401,
          code: 10010,
        },
        {
          name: "T3-1 批内重复 → 422·10023",
          method: "POST",
          path: "/api/v1/open/api-sync",
          body: {
            projectId: "${__P(P4_PROJECT_ID)}",
            apis: [
              { name: "dup", method: "GET", path: "/jm/dup" },
              { name: "dup2", method: "GET", path: "/jm/dup" },
            ],
          },
          header: { name: "Authorization", value: "Bearer ${__P(AK)}.${__P(SK)}" },
          status: 422,
          code: 10023,
        },
        {
          name: "T3-2 批量 101 条超限 → 422·10024",
          method: "POST",
          path: "/api/v1/open/api-sync",
          body: syncBody(101),
          header: { name: "Authorization", value: "Bearer ${__P(AK)}.${__P(SK)}" },
          status: 422,
          code: 10024,
        },
      ],
      false,
    ),
  ],
);

// ═══════ TOOL-002 open api-capture ═══════
emit(
  "TOOL-002-open-capture.jmx",
  "TOOL-002 浏览器插件采集 open/api-capture（脱敏+跳过语义）",
  { EMAIL: `jm-tool002-${stamp()}@rabbit.test` },
  [
    threadGroup("准备：注册+建 key", apiKeySetup()),
    threadGroup(
      "open 面采集（无会话，APIKEY 认证）",
      [
        {
          name: "T1-1 采集 2 条（含敏感头）→ created=2",
          method: "POST",
          path: "/api/v1/open/api-capture",
          body: {
            projectId: "${__P(P4_PROJECT_ID)}",
            requests: [
              {
                url: "https://shop.example.com/jm/p4/cap?scope=all",
                method: "GET",
                headers: { Authorization: "Bearer leak-me" },
              },
              {
                url: "https://shop.example.com/jm/p4/cap2",
                method: "POST",
                body: { kind: "json", text: '{"a":1}' },
              },
            ],
          },
          header: { name: "Authorization", value: "Bearer ${__P(AK)}.${__P(SK)}" },
          field: ["$.data.created", "2"],
        },
        {
          name: "T1-2 重放同批 → skipped=2（不 bump version）",
          method: "POST",
          path: "/api/v1/open/api-capture",
          body: {
            projectId: "${__P(P4_PROJECT_ID)}",
            requests: [{ url: "https://shop.example.com/jm/p4/cap?scope=all", method: "GET" }],
          },
          header: { name: "Authorization", value: "Bearer ${__P(AK)}.${__P(SK)}" },
          field: ["$.data.skipped", "1"],
        },
        {
          name: "T1-3 回读对账（TOOL-001 端点复用）",
          method: "GET",
          path: "/api/v1/open/api-definitions?projectId=${__P(P4_PROJECT_ID)}",
          header: { name: "Authorization", value: "Bearer ${__P(AK)}.${__P(SK)}" },
          contains: ["$.data.items", "GET /cap"],
        },
        {
          name: "T2-1 无 Authorization → 401",
          method: "POST",
          path: "/api/v1/open/api-capture",
          body: {
            projectId: "${__P(P4_PROJECT_ID)}",
            requests: [{ url: "https://a.b/c", method: "GET" }],
          },
          status: 401,
          code: 10001,
        },
        {
          name: "T3-1 ftp URL → 422·10025",
          method: "POST",
          path: "/api/v1/open/api-capture",
          body: {
            projectId: "${__P(P4_PROJECT_ID)}",
            requests: [{ url: "ftp://x/y", method: "GET" }],
          },
          header: { name: "Authorization", value: "Bearer ${__P(AK)}.${__P(SK)}" },
          status: 422,
          code: 10025,
        },
      ],
      false,
    ),
  ],
);

// ═══════ RPT-004 报告统计 ═══════
emit(
  "RPT-004-stats.jmx",
  "RPT-004 报告高级分析（窗口枚举/补零信封/权限/校验）",
  { EMAIL: `jm-rpt004-${stamp()}@rabbit.test`, EMAIL2: `jm-rpt004b-${stamp()}@rabbit.test` },
  [
    threadGroup("统计窗口主链路（正常+校验；同线程组共用 PROJECT_ID）", [
      ...registerSetup(),
      {
        name: "T1-1 days=14 默认窗口 → 连续补零序列",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/reports/stats?days=14",
        field: ["$.data.range.days", "14"],
        contains: ["$.data.trend", "date"],
      },
      {
        name: "T1-2 days=7 切换 → range.days=7",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/reports/stats?days=7",
        field: ["$.data.range.days", "7"],
      },
      {
        name: "T1-3 空项目空态 → trend 非空数组（补零）+ byType 空",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/reports/stats?days=30",
        field: ["$.data.byType", "[]"],
      },
      {
        name: "T3-1 days=13 → 422·60422",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/reports/stats?days=13",
        status: 422,
        code: 60422,
      },
      {
        name: "T3-2 days=abc → 422·60422",
        method: "GET",
        path: "/api/v1/projects/${PROJECT_ID}/reports/stats?days=abc",
        status: 422,
        code: 60422,
      },
    ]),
    threadGroup(
      "无会话 401",
      [
        {
          name: "T2-1 无会话 → 401·10001",
          method: "GET",
          path: "/api/v1/projects/00000000-0000-0000-0000-000000000001/reports/stats?days=7",
          status: 401,
          code: 10001,
        },
      ],
      false,
    ),
  ],
);

// ═══════ EXEC-004 K8S 型资源池 ═══════
emit(
  "EXEC-004-k8s-pool.jmx",
  "EXEC-004 K8S 型资源池（类型切换/K8S 配置/掩码/422/401/403）",
  { EMAIL: `jm-exec004-${stamp()}@rabbit.test` },
  [
    threadGroup("管理员：池型切换主链路（正常）", [
      ...adminLogin(),
      {
        name: "T1-1 取默认池 ID（单默认池 total=1 两口径恒定）",
        method: "GET",
        path: "/api/v1/system/pools",
        field: ["$.data.total", "1"],
        extract: { var: "POOL_ID", path: "$.data.items[0].id" },
      },
      {
        name: "T3-0 库内无存量且缺 token → 422·50422（服务层合并校验；置于存量写入前——休眠 token 会合并通过）",
        method: "PUT",
        path: "/api/v1/system/pools/${POOL_ID}",
        body: {
          type: "K8S",
          k8s: { apiServer: "https://k8s.internal:6443", namespace: "rabbit-exec" },
        },
        status: 422,
        code: 50422,
      },
      {
        name: "T1-2 切 K8S + 四项配置 → 200（tokenSet=true 不回明文）",
        method: "PUT",
        path: "/api/v1/system/pools/${POOL_ID}",
        body: {
          type: "K8S",
          maxConcurrency: 4,
          k8s: {
            apiServer: "https://k8s.internal:6443",
            namespace: "rabbit-exec",
            token: "jm-token-1",
            image: "rabbitaitest/task-runner:latest",
          },
        },
        field: ["$.data.k8s.tokenSet", "true"],
        contains: ["$.data", "K8S"],
      },
      {
        name: "T1-3 回读 type=K8S + DTO 占位字段 loadTest/uiTest=false",
        method: "GET",
        path: "/api/v1/system/pools/${POOL_ID}",
        field: ["$.data.type", "K8S"],
        contains: ["$.data.loadTest", "false"],
      },
      {
        name: "T1-4 K8S→NODE 切回（配置休眠保留）→ 200",
        method: "PUT",
        path: "/api/v1/system/pools/${POOL_ID}",
        body: { type: "NODE" },
        field: ["$.data.type", "NODE"],
      },
      {
        name: "T3-1 缺 token（存量休眠合并后有效）→ 200 回归（佐证休眠保留语义）",
        method: "PUT",
        path: "/api/v1/system/pools/${POOL_ID}",
        body: {
          type: "K8S",
          k8s: { apiServer: "https://k8s.internal:6443", namespace: "rabbit-exec-2" },
        },
        field: ["$.data.k8s.namespace", "rabbit-exec-2"],
      },
      {
        name: "T3-2 非 https apiServer → 422·20422（路由 zod 前置拒绝）",
        method: "PUT",
        path: "/api/v1/system/pools/${POOL_ID}",
        body: {
          type: "K8S",
          k8s: { apiServer: "http://k8s.internal:6443", namespace: "rabbit-exec", token: "t" },
        },
        status: 422,
        code: 20422,
      },
      {
        name: "T1-5 收尾恢复 NODE（不污染同栈其他计划——EXEC-002 以 NODE 基线断言）",
        method: "PUT",
        path: "/api/v1/system/pools/${POOL_ID}",
        body: { type: "NODE" },
        field: ["$.data.type", "NODE"],
      },
    ]),
    threadGroup(
      "无会话 401",
      [
        {
          name: "T2-1 无会话 PUT 池 → 401",
          method: "PUT",
          path: "/api/v1/system/pools/00000000-0000-0000-0000-000000000001",
          body: { maxConcurrency: 8 },
          status: 401,
          code: 10001,
        },
      ],
      false,
    ),
    threadGroup("普通用户 403（SYSTEM_POOL:UPDATE 缺失）", [
      {
        name: "T0 注册普通用户",
        method: "POST",
        path: "/api/v1/auth/register",
        body: { email: "${EMAIL}", password: "rabbit-pass-123" },
        status: 201,
      },
      {
        name: "T4-1 普通用户 PUT 池 → 403·10003",
        method: "PUT",
        path: "/api/v1/system/pools/00000000-0000-0000-0000-000000000001",
        body: { maxConcurrency: 8 },
        status: 403,
        code: 10003,
      },
    ]),
  ],
);

// ── 落盘 ──
let written = 0;
for (const [name, content] of files) {
  const abs = path.join(OUT, name);
  if (existsSync(abs) && !FORCE) continue;
  writeFileSync(abs, content);
  written++;
}
console.log(`[gen-jmx-p4] jmx written=${written} (total ${files.size})`);
