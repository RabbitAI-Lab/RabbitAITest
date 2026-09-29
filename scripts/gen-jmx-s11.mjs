#!/usr/bin/env node
/**
 * Sprint 11 JMeter 用例生成器：tests/api/SYS-009-oauth-token-channel.jmx。
 * 规范 rules/testing §2：四类场景（正常/401·403/422/列表信封）×四项断言。
 * 说明：oauth/device/code 与 oauth/token 为 RFC 8628 原生形状（无 {code,data} 信封）——
 * 该两采样器 raw=true 跳过 code 断言，以关键字段断言（$.error/$.device_code/$.access_token）替代。
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

/** 采样器四项断言（HTTP/code/关键字段/耗时）；raw=true 跳过信封 code 断言（RFC 形状端点）。 */
function sampler(d) {
  const status = d.status ?? 200;
  const code = d.raw ? null : (d.code ?? 0);
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
  if (code !== null) {
    assertions.push(`
          <JSONPathAssertion guiclass="JSONPathAssertionGui" testclass="JSONPathAssertion" testname="code=${code}">
            <stringProp name="JSON_PATH">$.code</stringProp>
            <stringProp name="EXPECTED_VALUE">${code}</stringProp>
            <boolProp name="JSONVALIDATION">true</boolProp>
          </JSONPathAssertion>
          <hashTree/>`);
  }
  for (const [jp, expect] of d.fields ?? []) {
    assertions.push(`
          <JSONPathAssertion guiclass="JSONPathAssertionGui" testclass="JSONPathAssertion" testname="field ${jp}=${esc(expect)}">
            <stringProp name="JSON_PATH">${esc(jp)}</stringProp>
            <stringProp name="EXPECTED_VALUE">${esc(expect)}</stringProp>
            <boolProp name="JSONVALIDATION">true</boolProp>
          </JSONPathAssertion>
          <hashTree/>`);
  }
  for (const [jp, frag] of d.contains ?? []) {
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
  const extracts = (d.extracts ?? [])
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
  // 变量→JMeter 属性桥（跨线程组传递：Bearer 负向断言须在无 cookie 组执行——session 会遮蔽 token 失效面）
  const setProps = (d.setProps ?? [])
    .map(
      ([varName, propName]) => `
          <JSR223PostProcessor guiclass="TestBeanGUI" testclass="JSR223PostProcessor" testname="prop ${propName}">
            <stringProp name="scriptLanguage">groovy</stringProp>
            <stringProp name="script">props.put("${propName}", vars.get("${varName}"))</stringProp>
          </JSR223PostProcessor>
          <hashTree/>`,
    )
    .join("");
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
  // form 裸体模式：值含 % 的预编码体会被 JMeter 二次编码（%3A→%253A）——
  // postBodyRaw 直发原始字节（SYS-009 的 RFC 8628 form 端点专用）
  if (d.postRaw) {
    bodyProp = `
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments">
            <collectionProp name="Arguments.arguments">
              <elementProp name="" elementType="HTTPArgument">
                <boolProp name="HTTPArgument.always_encode">false</boolProp>
                <stringProp name="Argument.value">${esc(d.body)}</stringProp>
                <stringProp name="Argument.metadata">=</stringProp>
              </elementProp>
            </collectionProp>
          </elementProp>
          <boolProp name="HTTPSampler.postBodyRaw">true</boolProp>`;
  }
  const mgr = (d.headers ?? [])
    .map(
      ([k, v]) => `
              <elementProp name="" elementType="Header">
                <stringProp name="Header.name">${esc(k)}</stringProp>
                <stringProp name="Header.value">${esc(v)}</stringProp>
              </elementProp>`,
    )
    .join("");
  const headers = mgr
    ? `
          <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="Headers">
            <collectionProp name="HeaderManager.headers">${mgr}
            </collectionProp>
          </HeaderManager>
          <hashTree/>`
    : "";
  return `
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${esc(d.name)}">${bodyProp}
          <stringProp name="HTTPSampler.domain">\${__P(HOST,localhost)}</stringProp>
          <stringProp name="HTTPSampler.port">\${__P(PORT,3100)}</stringProp>
          <stringProp name="HTTPSampler.path">${esc(d.path)}</stringProp>
          <stringProp name="HTTPSampler.method">${d.method}</stringProp>
          <boolProp name="HTTPSampler.follow_redirects">${d.noFollow ? "false" : "true"}</boolProp>
          <boolProp name="HTTPSampler.use_keepalive">true</boolProp>
        </HTTPSamplerProxy>
        <hashTree>${headers}${extracts}${setProps}${assertions.join("")}
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

const TS = "${__time(yyyyMMddHHmmss)}";
const ADMIN = { email: "admin@rabbit.test", password: "rabbit-admin-123" };
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const form = (pairs) => pairs.map(([k, v]) => `${k}=${v}`).join("&");

const loginSampler = () =>
  sampler({
    name: "登录（admin 种子）",
    path: "/api/v1/auth/login",
    method: "POST",
    body: ADMIN,
    headers: [["Content-Type", "application/json"]],
    fields: [["$.data.email", ADMIN.email]],
  });

// ══════ G1 正常路径（cookie 组）：登录→发码→pending→批准→交换→旋转→重放 ══════
const g1 = threadGroup("SYS-009-T1 正常路径", [
  loginSampler(),
  sampler({
    name: "device/code 发码（RFC 形状）",
    path: "/api/v1/oauth/device/code",
    method: "POST",
    raw: true,
    body: form([["client_id", "rabbit-cli"], ["scope", "read,exec"]]),
    headers: [["Content-Type", "application/x-www-form-urlencoded"]],
    fields: [["$.expires_in", "600"]],
    contains: [
      ["$.device_code", "rdc_"],
      ["$.user_code", "-"],
      ["$.verification_uri_complete", "/oauth/device?code="],
    ],
    extracts: [
      { var: "DEVICE_CODE", path: "$.device_code" },
      { var: "USER_CODE", path: "$.user_code" },
    ],
  }),
  sampler({
    name: "token 轮询（未批准→authorization_pending）",
    path: "/api/v1/oauth/token",
    method: "POST",
    status: 400,
    raw: true,
    body: form([
      ["grant_type", DEVICE_GRANT],
      ["device_code", "${DEVICE_CODE}"],
      ["client_id", "rabbit-cli"],
    ]),
    headers: [["Content-Type", "application/x-www-form-urlencoded"]],
    fields: [["$.error", "authorization_pending"]],
  }),
  sampler({
    name: "approve 批准（session）",
    path: "/api/v1/oauth/device/approve",
    method: "POST",
    body: { userCode: "${USER_CODE}", approve: true },
    headers: [["Content-Type", "application/json"]],
    fields: [["$.data.approved", "true"]],
  }),
  sampler({
    name: "token 交换（→access/refresh）",
    path: "/api/v1/oauth/token",
    method: "POST",
    raw: true,
    body: form([
      ["grant_type", DEVICE_GRANT],
      ["device_code", "${DEVICE_CODE}"],
      ["client_id", "rabbit-cli"],
    ]),
    headers: [["Content-Type", "application/x-www-form-urlencoded"]],
    fields: [
      ["$.expires_in", "7200"],
      ["$.scope", "read,exec"],
      ["$.token_type", "Bearer"],
    ],
    contains: [
      ["$.access_token", "rat_"],
      ["$.refresh_token", "rrt_"],
    ],
    extracts: [
      { var: "AT", path: "$.access_token" },
      { var: "RT", path: "$.refresh_token" },
    ],
    setProps: [["AT", "AT"]],
  }),
  sampler({
    name: "refresh 旋转（新 access）",
    path: "/api/v1/oauth/token",
    method: "POST",
    raw: true,
    body: form([
      ["grant_type", "refresh_token"],
      ["refresh_token", "${RT}"],
    ]),
    headers: [["Content-Type", "application/x-www-form-urlencoded"]],
    contains: [["$.access_token", "rat_"]],
    extracts: [
      { var: "AT2", path: "$.access_token" },
      { var: "RT2", path: "$.refresh_token" },
    ],
    setProps: [["AT2", "AT2"]],
  }),
  sampler({
    name: "重放旧 refresh（→invalid_grant）",
    path: "/api/v1/oauth/token",
    method: "POST",
    status: 400,
    raw: true,
    body: form([
      ["grant_type", "refresh_token"],
      ["refresh_token", "${RT}"],
    ]),
    headers: [["Content-Type", "application/x-www-form-urlencoded"]],
    fields: [["$.error", "invalid_grant"]],
  }),
]);

// ══════ G2a read-scope 取证（cookie 组：approve 需 session；AT_RO 桥接属性）══════
const g2a = threadGroup("SYS-009-T2a read-scope 取证", [
  loginSampler(),
  sampler({
    name: "read-scope 发码",
    path: "/api/v1/oauth/device/code",
    method: "POST",
    raw: true,
    body: form([["client_id", "rabbit-cli"], ["scope", "read"]]),
    headers: [["Content-Type", "application/x-www-form-urlencoded"]],
    contains: [["$.device_code", "rdc_"]],
    extracts: [
      { var: "D2", path: "$.device_code" },
      { var: "U2", path: "$.user_code" },
    ],
  }),
  sampler({
    name: "read-scope 批准",
    path: "/api/v1/oauth/device/approve",
    method: "POST",
    body: { userCode: "${U2}", approve: true },
    headers: [["Content-Type", "application/json"]],
    fields: [["$.data.approved", "true"]],
  }),
  sampler({
    name: "read-scope 交换",
    path: "/api/v1/oauth/token",
    method: "POST",
    raw: true,
    body: form([["grant_type", DEVICE_GRANT], ["device_code", "${D2}"]]),
    headers: [["Content-Type", "application/x-www-form-urlencoded"]],
    fields: [["$.scope", "read"]],
    extracts: [{ var: "AT_RO", path: "$.access_token" }],
    setProps: [["AT_RO", "AT_RO"]],
  }),
]);

// ══════ G2b Bearer 负向断言（无 cookie 组——session 会遮蔽 token 失效面）══════
const g2b = threadGroup(
  "SYS-009-T2b Bearer 越权/失效（无 cookie）",
  [
    sampler({
      name: "伪造 access token→401",
      path: "/api/v1/personal/me",
      method: "GET",
      status: 401,
      code: 10001,
      headers: [["Authorization", "Bearer rat_forged-token-jmx"]],
      fields: [["$.code", "10001"]],
    }),
    sampler({
      name: "伪造 device_code→expired_token",
      path: "/api/v1/oauth/token",
      method: "POST",
      status: 400,
      raw: true,
      body: form([
        ["grant_type", DEVICE_GRANT],
        ["device_code", "rdc_jmx-forged"],
      ]),
      headers: [["Content-Type", "application/x-www-form-urlencoded"]],
      fields: [["$.error", "expired_token"]],
    }),
    sampler({
      name: "read token 写操作→403 10003（scope 缺 write）",
      path: "/api/v1/personal/api-keys",
      method: "POST",
      status: 403,
      code: 10003,
      body: { name: "jmx-scope" },
      headers: [
        ["Content-Type", "application/json"],
        ["Authorization", "Bearer ${__P(AT_RO)}"],
      ],
      fields: [["$.code", "10003"]],
      contains: [["$.message", "scope"]],
    }),
    sampler({
      name: "read token 读操作→200（scope 允许）",
      path: "/api/v1/personal/api-keys",
      method: "GET",
      headers: [["Authorization", "Bearer ${__P(AT_RO)}"]],
    }),
    sampler({
      name: "重放后全家吊销（旋转 access→401）",
      path: "/api/v1/personal/me",
      method: "GET",
      status: 401,
      code: 10001,
      headers: [["Authorization", "Bearer ${__P(AT2)}"]],
      fields: [["$.code", "10001"]],
    }),
    sampler({
      name: "oauth/revoke 登出（豁免 scope）",
      path: "/api/v1/oauth/revoke",
      method: "POST",
      body: {},
      headers: [
        ["Content-Type", "application/json"],
        ["Authorization", "Bearer ${__P(AT_RO)}"],
      ],
      fields: [["$.data.revoked", "true"]],
    }),
    sampler({
      name: "吊销后再用→401",
      path: "/api/v1/personal/me",
      method: "GET",
      status: 401,
      code: 10001,
      headers: [["Authorization", "Bearer ${__P(AT_RO)}"]],
      fields: [["$.code", "10001"]],
    }),
  ],
  false,
);

// ══════ G3 校验类（422/400 参数面）══════
const g3 = threadGroup("SYS-009-T3 校验失败", [
  loginSampler(),
  sampler({
    name: "approve 坏 user_code→422 10030",
    path: "/api/v1/oauth/device/approve",
    method: "POST",
    status: 422,
    code: 10030,
    body: { userCode: "ZZZZ-ZZZZ", approve: true },
    headers: [["Content-Type", "application/json"]],
    fields: [["$.code", "10030"]],
  }),
  sampler({
    name: "approve 缺字段→422",
    path: "/api/v1/oauth/device/approve",
    method: "POST",
    status: 422,
    code: 20422,
    body: { userCode: "ABCD-EFGH" },
    headers: [["Content-Type", "application/json"]],
    fields: [["$.code", "20422"]],
  }),
  sampler({
    name: "device/code 非法 scope→invalid_scope",
    path: "/api/v1/oauth/device/code",
    method: "POST",
    status: 400,
    raw: true,
    body: form([["client_id", "rabbit-cli"], ["scope", "admin"]]),
    headers: [["Content-Type", "application/x-www-form-urlencoded"]],
    fields: [["$.error", "invalid_scope"]],
  }),
  sampler({
    name: "token 未知 grant_type→unsupported",
    path: "/api/v1/oauth/token",
    method: "POST",
    status: 400,
    raw: true,
    body: form([["grant_type", "password"]]),
    headers: [["Content-Type", "application/x-www-form-urlencoded"]],
    fields: [["$.error", "unsupported_grant_type"]],
  }),
]);

// ══════ G4 列表信封：授权会话（含分页语义 data 数组）══════
const g4 = threadGroup("SYS-009-T4 授权会话列表信封", [
  loginSampler(),
  sampler({
    name: "授权会话列表（session）",
    path: "/api/v1/personal/authorizations",
    method: "GET",
    fields: [["$.code", "0"]],
    contains: [
      ["$.data[0].clientId", "rabbit-cli"],
      ["$.data[0].scope", "read"],
    ],
  }),
  sampler({
    name: "全部吊销（DELETE）",
    path: "/api/v1/personal/authorizations",
    method: "DELETE",
    fields: [["$.code", "0"]],
    contains: [["$.data.revoked", "0"]],
  }),
  sampler({
    name: "吊销后再列（数组仍在，状态 REVOKED）",
    path: "/api/v1/personal/authorizations",
    method: "GET",
    fields: [["$.code", "0"]],
    contains: [["$.data[0].status", "REVOKED"]],
  }),
]);

const xml = plan("SYS-009 OAuth Token 通道", { TS }, [g1, g2a, g2b, g3, g4]);
writeFileSync(path.join(OUT, "SYS-009-oauth-token-channel.jmx"), xml);
console.log("[gen-jmx-s11] 写入 tests/api/SYS-009-oauth-token-channel.jmx");
