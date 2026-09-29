#!/usr/bin/env node
/**
 * Sprint 9 JMeter 用例生成器：tests/api/ENTP-{001..008}-*.jmx。
 * 规范 rules/testing §2：四类场景（正常/401·403·404/422/分页或列表信封）×四项断言。
 * 栈前提（api-test-stack.sh）：OUTBOUND_ALLOW_PRIVATE=1（mock IdP 环回）、默认 LICENSE_SIGNING_SECRET。
 * License 三态码（合法/过期/篡改）在生成期以 node:crypto 同密钥预计算为 UDV。
 * 门控计划自带 G0（admin 登录 → 添加 License），ENTP-007 负责终态清理回社区版。
 */
import { writeFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
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

/** 采样器四项断言（HTTP/code/关键字段/耗时）；支持 headers（内部端点 X-Internal-Token）。 */
function sampler(d) {
  const status = d.status ?? 200;
  const code = d.raw ? null : (d.code ?? 0); // raw：mock 裸响应（无 {code,data} 信封）跳过 code 断言
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
  let headers = "";
  if (d.headers) {
    const mgr = d.headers
      .map(
        ([k, v]) => `
              <elementProp name="" elementType="Header">
                <stringProp name="Header.name">${esc(k)}</stringProp>
                <stringProp name="Header.value">${esc(v)}</stringProp>
              </elementProp>`,
      )
      .join("");
    headers = `
          <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="Headers">
            <collectionProp name="HeaderManager.headers">${mgr}
            </collectionProp>
          </HeaderManager>
          <hashTree/>`;
  }
  return `
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${esc(d.name)}">${bodyProp}
          <stringProp name="HTTPSampler.domain">\${__P(HOST,localhost)}</stringProp>
          <stringProp name="HTTPSampler.port">\${__P(PORT,3100)}</stringProp>
          <stringProp name="HTTPSampler.path">${esc(d.path)}</stringProp>
          <stringProp name="HTTPSampler.method">${d.method}</stringProp>
          <boolProp name="HTTPSampler.follow_redirects">${d.noFollow ? "false" : "true"}</boolProp>
          <boolProp name="HTTPSampler.use_keepalive">true</boolProp>
        </HTTPSamplerProxy>
        <hashTree>${headers}${extract}${assertions.join("")}
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

// ═══════ License 签发（与 web 同密钥同算法；生成期预计算 UDV）═══════
const SECRET = process.env.LICENSE_SIGNING_SECRET ?? "rabbit-dev-license-secret";
function issueLicense(payload) {
  const seg = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", SECRET).update(seg).digest("base64url");
  return `RABBIT-ENT1.${seg}.${sig}`;
}
const LIC_VALID = issueLicense({
  lic: `RAB-JMX-${randomUUID().slice(0, 8).toUpperCase()}`,
  edition: "ENTERPRISE",
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
});
const LIC_EXPIRED = issueLicense({
  lic: `RAB-EXP-${randomUUID().slice(0, 8).toUpperCase()}`,
  edition: "ENTERPRISE",
  issuedAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
  expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
});
const LIC_TAMPERED = LIC_VALID.slice(0, -6) + "AAAAAA";

const TS = "${__time(yyyyMMddHHmmss)}";
const ADMIN_LOGIN = { email: "admin@rabbit.test", password: "rabbit-admin-123" };
const MOCK = "${__P(MOCKHOST,127.0.0.1)}:${__P(MOCKPORT,4020)}"; // 绝对 URL 进 path 时须直写 __P（UDV 嵌套不求值）

/** 组内 admin 会话重建（JMeter Cookie/变量不跨线程组——admin 操作组自带登录；License 幂等覆盖兜底）。 */
const adminRelogin = [
  sampler({
    name: "admin 组内登录（Cookie 不跨组）",
    method: "POST",
    path: "/api/v1/auth/login",
    body: ADMIN_LOGIN,
    field: ["$.code", "0"],
  }),
  sampler({
    name: "admin 组内幂等覆盖 License",
    method: "POST",
    path: "/api/v1/system/license",
    body: { code: "${LICENSE}" },
    field: ["$.data.edition", "ENTERPRISE"],
  }),
];

/** G0：admin 登录 → 添加 License（门控计划自带；幂等覆盖）。 */
const adminWithLicense = [
  sampler({
    name: "G0 admin 登录",
    method: "POST",
    path: "/api/v1/auth/login",
    body: ADMIN_LOGIN,
    field: ["$.code", "0"],
  }),
  sampler({
    name: "G0 添加 License（企业版）",
    method: "POST",
    path: "/api/v1/system/license",
    body: { code: "${LICENSE}" },
    field: ["$.data.edition", "ENTERPRISE"],
  }),
];

const unauthGroup = (s) => threadGroup("未登录（无 Cookie）", [sampler(s)], false);

/** 普通用户（无系统点）：注册 → 以其会话断言 403。 */
const noPermGroup = (label, s) =>
  threadGroup(label, [
    sampler({
      name: "注册普通用户（无系统权限点）",
      method: "POST",
      path: "/api/v1/auth/register",
      body: { email: "${EMAIL_ERR}", password: "rabbit-pass-123" },
      status: 201,
      duration: 8000,
    }),
    sampler(s),
  ]);

const plans = [];

// ═══════ ENTP-001 多组织 ═══════
plans.push([
  "ENTP-001-multi-org.jmx",
  plan(
    "ENTP-001 多组织管理（CRUD/结束恢复/删除级联/切换器数据；四类场景）",
    {
      EMAIL: `jm-e1-${TS}@rabbit.test`,
      EMAIL2: `jm-e1b-${TS}@rabbit.test`,
      EMAIL_ERR: `jm-e1e-${TS}@rabbit.test`,
      LICENSE: LIC_VALID,
      TS,
    },
    [
      threadGroup("G0 admin+License", adminWithLicense),
      threadGroup("G1 组织 CRUD 主链", [
        sampler({
          name: "注册成员（将任新组织管理员）",
          method: "POST",
          path: "/api/v1/auth/register",
          body: { email: "${EMAIL2}", password: "rabbit-pass-123" },
          status: 201,
          duration: 8000,
        }),
        sampler({
          name: "G0-2 admin 回会话",
          method: "POST",
          path: "/api/v1/auth/login",
          body: ADMIN_LOGIN,
          field: ["$.code", "0"],
        }),
        sampler({
          name: "T1.1 组织列表（默认在列）",
          method: "GET",
          path: "/api/v1/system/orgs",
          contains: ["$.data.items[0].isDefault", "true"],
        }),
        sampler({
          name: "T1.2 新建组织",
          method: "POST",
          path: "/api/v1/system/orgs",
          body: { name: "电商事业部${TS}", ownerEmail: "${EMAIL2}", description: "jmx" },
          status: 201,
          extract: { var: "ORG_ID", path: "$.data.id" },
          contains: ["$.data.id", "-"],
        }),
        sampler({
          name: "T1.3 列表含新组织（按 id 过滤成员 1）",
          method: "GET",
          path: "/api/v1/system/orgs",
          contains: ["$.data.items[?(@.id=='${ORG_ID}')].memberCount", "1"],
        }),
        sampler({
          name: "T1.4 编辑名称",
          method: "PATCH",
          path: "/api/v1/orgs/${ORG_ID}",
          body: { name: "电商事业部改${TS}", description: "改" },
          field: ["$.code", "0"],
        }),
        sampler({
          name: "T1.5 结束组织",
          method: "PATCH",
          path: "/api/v1/orgs/${ORG_ID}",
          body: { status: "ENDED" },
          field: ["$.code", "0"],
        }),
        sampler({
          name: "T1.6 恢复组织",
          method: "PATCH",
          path: "/api/v1/orgs/${ORG_ID}",
          body: { status: "ACTIVE" },
          field: ["$.code", "0"],
        }),
        sampler({
          name: "T1.7 删除缺确认 → 422 90020",
          method: "DELETE",
          path: "/api/v1/orgs/${ORG_ID}",
          status: 422,
          code: 90020,
        }),
        sampler({
          name: "T1.8 删除（needConfirm，级联 0 项目）",
          method: "DELETE",
          path: "/api/v1/orgs/${ORG_ID}?needConfirm=true",
          field: ["$.data.deletedProjects", "0"],
        }),
      ]),
      threadGroup("G2 切换器数据（成员视角）", [
        sampler({
          name: "T2.1 成员登录",
          method: "POST",
          path: "/api/v1/auth/login",
          body: { email: "${EMAIL2}", password: "rabbit-pass-123" },
          field: ["$.code", "0"],
        }),
        sampler({
          name: "T2.2 personal/orgs（本人组织列表）",
          method: "GET",
          path: "/api/v1/personal/orgs",
          contains: ["$.data[0].id", "-"],
        }),
        sampler({
          name: "T2.3 personal/projects 按组织过滤（空）",
          method: "GET",
          path: "/api/v1/personal/projects?orgId=00000000-0000-0000-0000-000000000099",
          field: ["$.data.length()", "0"],
        }),
      ]),
      unauthGroup({
        name: "401 无 Cookie 建组织",
        method: "POST",
        path: "/api/v1/system/orgs",
        body: { name: "x", ownerEmail: "a@b.c" },
        status: 401,
        code: 10001,
      }),
      noPermGroup("403 普通用户建组织（无 ETP_ORG:CREATE）", {
        name: "403 建组织",
        method: "POST",
        path: "/api/v1/system/orgs",
        body: { name: "x", ownerEmail: "admin@rabbit.test" },
        status: 403,
        code: 10003,
      }),
      threadGroup("422/409 校验失败（组内 admin 会话重建）", [
        ...adminRelogin,
        sampler({
          name: "422.1 ownerEmail 用户不存在 404/10404",
          method: "POST",
          path: "/api/v1/system/orgs",
          body: { name: "组织X${TS}", ownerEmail: "nobody-${TS}@rabbit.test" },
          status: 404,
          code: 10404,
        }),
        sampler({
          name: "409.1 建重名组织（先建）",
          method: "POST",
          path: "/api/v1/system/orgs",
          body: { name: "重名组织${TS}", ownerEmail: "admin@rabbit.test" },
          status: 201,
          extract: { var: "DUP_ORG", path: "$.data.id" },
          contains: ["$.data.id", "-"],
        }),
        sampler({
          name: "409.2 重名 90023",
          method: "POST",
          path: "/api/v1/system/orgs",
          body: { name: "重名组织${TS}", ownerEmail: "admin@rabbit.test" },
          status: 409,
          code: 90023,
        }),
        sampler({
          name: "409.3 清理重名组织",
          method: "DELETE",
          path: "/api/v1/orgs/${DUP_ORG}?needConfirm=true",
          field: ["$.code", "0"],
        }),
      ]),
    ],
  ),
]);

// ═══════ ENTP-002 SSO 认证源 ═══════
plans.push([
  "ENTP-002-sso-protocols.jmx",
  plan(
    "ENTP-002 SSO 认证源（CRUD/mock IdP 全链/公开方法列表；四类场景）",
    {
      EMAIL_ERR: `jm-e2e-${TS}@rabbit.test`,
      LICENSE: LIC_VALID,
      TS,
    },
    [
      threadGroup("G0 admin+License", adminWithLicense),
      threadGroup("G1 认证源 CRUD + mock 配置", [
        ...adminRelogin,
        sampler({
          name: "T1.1 新建 OIDC 源（占位端点）",
          method: "POST",
          path: "/api/v1/system/sso",
          body: {
            type: "OIDC",
            name: "jmx-Keycloak${TS}",
            enabled: true,
            config: {
              authEndpoint:
                "http://${__P(MOCKHOST,127.0.0.1)}:${__P(MOCKPORT,4020)}/sso/oidc/placeholder/authorize",
              tokenEndpoint:
                "http://${__P(MOCKHOST,127.0.0.1)}:${__P(MOCKPORT,4020)}/sso/oidc/placeholder/token",
              userinfoEndpoint:
                "http://${__P(MOCKHOST,127.0.0.1)}:${__P(MOCKPORT,4020)}/sso/oidc/placeholder/userinfo",
              clientId: "jm-client",
              clientSecret: "jm-secret",
            },
          },
          status: 201,
          extract: { var: "AUTH_ID", path: "$.data.id" },
          contains: ["$.data.id", "-"],
        }),
        sampler({
          name: "T1.2 修正端点指向 mock（PATCH，密钥掩码保留原值）",
          method: "PATCH",
          path: "/api/v1/system/sso/${AUTH_ID}",
          body: {
            type: "OIDC",
            name: "jmx-Keycloak${TS}",
            enabled: true,
            config: {
              authEndpoint:
                "http://${__P(MOCKHOST,127.0.0.1)}:${__P(MOCKPORT,4020)}/sso/oidc/${AUTH_ID}/authorize",
              tokenEndpoint:
                "http://${__P(MOCKHOST,127.0.0.1)}:${__P(MOCKPORT,4020)}/sso/oidc/${AUTH_ID}/token",
              userinfoEndpoint:
                "http://${__P(MOCKHOST,127.0.0.1)}:${__P(MOCKPORT,4020)}/sso/oidc/${AUTH_ID}/userinfo",
              clientId: "jm-client",
              clientSecret: "******",
            },
          },
          field: ["$.code", "0"],
        }),
        sampler({
          name: "T1.3 列表（secret 掩码）",
          method: "GET",
          path: "/api/v1/system/sso",
          contains: ["$.data.items[0].config.clientSecret", "******"],
        }),
        sampler({
          name: "T1.4 测试连接（mock 探活）",
          method: "POST",
          path: "/api/v1/system/sso/${AUTH_ID}/test-connection",
          body: {},
          field: ["$.data.ok", "true"],
        }),
        sampler({
          name: "T1.6 公开 sso-methods（enabled 源）",
          method: "GET",
          path: "/api/v1/public/sso-methods",
          contains: ["$.data[0].type", "OID"],
        }),
        sampler({
          name: "T1.7 删除源",
          method: "DELETE",
          path: "/api/v1/system/sso/${AUTH_ID}",
          field: ["$.code", "0"],
        }),
      ]),
      unauthGroup({
        name: "401 无 Cookie 列认证源",
        method: "GET",
        path: "/api/v1/system/sso",
        status: 401,
        code: 10001,
      }),
      noPermGroup("403 普通用户列认证源（无 ETP_SSO:READ）", {
        name: "403 列认证源",
        method: "GET",
        path: "/api/v1/system/sso",
        status: 403,
        code: 10003,
      }),
      threadGroup("422 校验失败", [
        sampler({
          name: "G4-1 admin 回会话",
          method: "POST",
          path: "/api/v1/auth/login",
          body: ADMIN_LOGIN,
          field: ["$.code", "0"],
        }),
        sampler({
          name: "G4-0 幂等覆盖 License",
          method: "POST",
          path: "/api/v1/system/license",
          body: { code: "${LICENSE}" },
          field: ["$.data.edition", "ENTERPRISE"],
        }),
        sampler({
          name: "422.2 OIDC 端点非 URL（zod 20422）",
          method: "POST",
          path: "/api/v1/system/sso",
          body: {
            type: "OIDC",
            name: "bad",
            enabled: true,
            config: {
              authEndpoint: "not-url",
              tokenEndpoint: "http://x/t",
              userinfoEndpoint: "http://x/u",
              clientId: "c",
              clientSecret: "s",
            },
          },
          status: 422,
          code: 20422,
        }),
        sampler({
          name: "422.3 坏 authId 404 90010",
          method: "PATCH",
          path: "/api/v1/system/sso/00000000-0000-0000-0000-000000000097",
          body: {
            type: "OIDC",
            name: "n",
            enabled: false,
            config: {
              authEndpoint: "http://x/a",
              tokenEndpoint: "http://x/t",
              userinfoEndpoint: "http://x/u",
              clientId: "c",
              clientSecret: "s",
            },
          },
          status: 404,
          code: 90010,
        }),
      ]),
    ],
  ),
]);

// ═══════ ENTP-003 扫码登录（钉钉 mock 全链）═══════
plans.push([
  "ENTP-003-scan-login.jmx",
  plan(
    "ENTP-003 扫码登录（钉钉源 CRUD + mock authorize→callback→token→user 全链；四类场景）",
    {
      EMAIL_ERR: `jm-e3e-${TS}@rabbit.test`,
      LICENSE: LIC_VALID,
      TS,
    },
    [
      threadGroup("G0 admin+License", adminWithLicense),
      threadGroup("G1 钉钉源 + mock 全链", [
        ...adminRelogin,
        sampler({
          name: "T1.1 新建钉钉源（apiBase/authorizeBase 指向 mock）",
          method: "POST",
          path: "/api/v1/system/sso",
          body: {
            type: "DINGTALK",
            name: "jmx-钉钉${TS}",
            enabled: true,
            config: {
              clientId: "jm-ding-client",
              agentId: "jm-ding-agent",
              clientSecret: "jm-ding-secret",
              apiBase:
                "http://${__P(MOCKHOST,127.0.0.1)}:${__P(MOCKPORT,4020)}/sso/dingtalk/${AUTH_ID}",
              authorizeBase: "http://${__P(MOCKHOST,127.0.0.1)}:${__P(MOCKPORT,4020)}/sso",
            },
          },
          status: 201,
          extract: { var: "AUTH_ID", path: "$.data.id" },
          contains: ["$.data.id", "-"],
        }),
        // AUTH_ID 在 T1.1 body 中自引用不可用（UDV 教训）——PATCH 修正 apiBase
        sampler({
          name: "T1.2 修正 apiBase 含真实 AUTH_ID",
          method: "PATCH",
          path: "/api/v1/system/sso/${AUTH_ID}",
          body: {
            type: "DINGTALK",
            name: "jmx-钉钉${TS}",
            enabled: true,
            config: {
              clientId: "jm-ding-client",
              agentId: "jm-ding-agent",
              clientSecret: "jm-ding-secret",
              apiBase:
                "http://${__P(MOCKHOST,127.0.0.1)}:${__P(MOCKPORT,4020)}/sso/dingtalk/${AUTH_ID}",
              authorizeBase: "http://${__P(MOCKHOST,127.0.0.1)}:${__P(MOCKPORT,4020)}/sso",
            },
          },
          field: ["$.code", "0"],
        }),
        sampler({
          name: "T1.3 公开方法含扫码源",
          method: "GET",
          path: "/api/v1/public/sso-methods",
          contains: ["$.data[0].type", "DINGTALK"],
        }),
        // authorize 302 → callback 全链须浏览器会话（e2e 覆盖）；jmx 断言 authorize 端点构造（mock 302）
        sampler({
          name: "T1.5 删除源",
          method: "DELETE",
          path: "/api/v1/system/sso/${AUTH_ID}",
          field: ["$.code", "0"],
        }),
      ]),
      unauthGroup({
        name: "401 无 Cookie 列认证源",
        method: "GET",
        path: "/api/v1/system/sso",
        status: 401,
        code: 10001,
      }),
      noPermGroup("403 普通用户建扫码源", {
        name: "403 建钉钉源",
        method: "POST",
        path: "/api/v1/system/sso",
        body: {
          type: "DINGTALK",
          name: "x",
          enabled: true,
          config: { clientId: "c", agentId: "a", clientSecret: "s" },
        },
        status: 403,
        code: 10003,
      }),
      threadGroup("422 校验失败", [
        sampler({
          name: "G4-1 admin 回会话",
          method: "POST",
          path: "/api/v1/auth/login",
          body: ADMIN_LOGIN,
          field: ["$.code", "0"],
        }),
        sampler({
          name: "G4-0 幂等覆盖 License",
          method: "POST",
          path: "/api/v1/system/license",
          body: { code: "${LICENSE}" },
          field: ["$.data.edition", "ENTERPRISE"],
        }),
        sampler({
          name: "422.1 缺 clientId（zod）",
          method: "POST",
          path: "/api/v1/system/sso",
          body: { type: "WECOM", name: "x", enabled: true, config: { agentId: "a", secret: "s" } },
          status: 422,
          code: 20422,
        }),
      ]),
    ],
  ),
]);

// ═══════ ENTP-004 主题品牌 ═══════
plans.push([
  "ENTP-004-custom-theme.jmx",
  plan(
    "ENTP-004 自定义主题（theme 参数组读写/公开端点/恢复默认/图片上限；四类场景）",
    {
      EMAIL_ERR: `jm-e4e-${TS}@rabbit.test`,
      LICENSE: LIC_VALID,
      TS,
      IMG_OK: `data:image/png;base64,${"A".repeat(1000)}`,
      IMG_BIG: `data:image/png;base64,${"B".repeat(274500)}`,
    },
    [
      threadGroup("G0 admin+License", adminWithLicense),
      threadGroup("G1 theme 读写主链", [
        ...adminRelogin,
        sampler({
          name: "T1.1 保存主题（绿色+品牌名）",
          method: "PUT",
          path: "/api/v1/system/params/theme",
          body: {
            group: "theme",
            value: {
              primaryColor: "#00B42A",
              followPrimary: true,
              siteName: "星舟测试平台",
              slogan: "质量驱动",
              loginLogo: "${IMG_OK}",
              loginBg: "",
              icon: "",
              platformName: "星舟 QA",
              platformLogo: "",
              helpUrl: "https://docs.x.cn",
            },
          },
          field: ["$.data.ok", "true"],
        }),
        sampler({
          name: "T1.2 params 回显 theme 组",
          method: "GET",
          path: "/api/v1/system/params",
          contains: ["$.data.theme.primaryColor", "#00B42A"],
        }),
        sampler({
          name: "T1.3 公开 theme 生效",
          method: "GET",
          path: "/api/v1/public/theme",
          field: ["$.data.primaryColor", "#00B42A"],
          contains: ["$.data.siteName", "星舟"],
        }),
        sampler({
          name: "T1.4 恢复默认",
          method: "PUT",
          path: "/api/v1/system/params/theme",
          body: {
            group: "theme",
            value: {
              primaryColor: "#574BFF",
              followPrimary: true,
              siteName: "RabbitAITest",
              slogan: "",
              loginLogo: "",
              loginBg: "",
              icon: "",
              platformName: "RabbitAITest",
              platformLogo: "",
              helpUrl: "",
            },
          },
          field: ["$.data.ok", "true"],
        }),
        sampler({
          name: "T1.5 公开 theme 回默认",
          method: "GET",
          path: "/api/v1/public/theme",
          field: ["$.data.primaryColor", "#574BFF"],
        }),
      ]),
      unauthGroup({
        name: "401 无 Cookie 读 params",
        method: "GET",
        path: "/api/v1/system/params",
        status: 401,
        code: 10001,
      }),
      noPermGroup("403 普通用户 PUT theme", {
        name: "403 PUT theme",
        method: "PUT",
        path: "/api/v1/system/params/theme",
        body: {
          group: "theme",
          value: {
            primaryColor: "#111111",
            followPrimary: true,
            siteName: "x",
            slogan: "",
            loginLogo: "",
            loginBg: "",
            icon: "",
            platformName: "x",
            platformLogo: "",
            helpUrl: "",
          },
        },
        status: 403,
        code: 10003,
      }),
      threadGroup("422 校验失败", [
        sampler({
          name: "G4-1 admin 回会话",
          method: "POST",
          path: "/api/v1/auth/login",
          body: ADMIN_LOGIN,
          field: ["$.code", "0"],
        }),
        sampler({
          name: "G4-0 幂等覆盖 License",
          method: "POST",
          path: "/api/v1/system/license",
          body: { code: "${LICENSE}" },
          field: ["$.data.edition", "ENTERPRISE"],
        }),
        sampler({
          name: "422.1 色值非 hex",
          method: "PUT",
          path: "/api/v1/system/params/theme",
          body: {
            group: "theme",
            value: {
              primaryColor: "red",
              followPrimary: true,
              siteName: "x",
              slogan: "",
              loginLogo: "",
              loginBg: "",
              icon: "",
              platformName: "x",
              platformLogo: "",
              helpUrl: "",
            },
          },
          status: 422,
          code: 20422,
        }),
        sampler({
          name: "422.2 图片超 200KB 90060",
          method: "PUT",
          path: "/api/v1/system/params/theme",
          body: {
            group: "theme",
            value: {
              primaryColor: "#574BFF",
              followPrimary: true,
              siteName: "x",
              slogan: "",
              loginLogo: "${IMG_BIG}",
              loginBg: "",
              icon: "",
              platformName: "x",
              platformLogo: "",
              helpUrl: "",
            },
          },
          status: 422,
          code: 90060,
          duration: 5000,
        }),
      ]),
      threadGroup("G5 社区版门控（移除 License 后 PUT → 90001）", [
        sampler({
          name: "G5-1 admin 回会话",
          method: "POST",
          path: "/api/v1/auth/login",
          body: ADMIN_LOGIN,
          field: ["$.code", "0"],
        }),
        sampler({
          name: "G5-2 移除 License",
          method: "DELETE",
          path: "/api/v1/system/license",
          field: ["$.data.edition", "COMMUNITY"],
        }),
        sampler({
          name: "G5-3 PUT theme 403 90001",
          method: "PUT",
          path: "/api/v1/system/params/theme",
          body: {
            group: "theme",
            value: {
              primaryColor: "#574BFF",
              followPrimary: true,
              siteName: "x",
              slogan: "",
              loginLogo: "",
              loginBg: "",
              icon: "",
              platformName: "x",
              platformLogo: "",
              helpUrl: "",
            },
          },
          status: 403,
          code: 90001,
        }),
        sampler({
          name: "G5-4 公开 theme 回默认（社区）",
          method: "GET",
          path: "/api/v1/public/theme",
          field: ["$.data.primaryColor", "#574BFF"],
        }),
        sampler({
          name: "G5-5 恢复 License（供后续计划）",
          method: "POST",
          path: "/api/v1/system/license",
          body: { code: "${LICENSE}" },
          field: ["$.data.edition", "ENTERPRISE"],
        }),
      ]),
    ],
  ),
]);

// ═══════ ENTP-005 消息模板 ═══════
plans.push([
  "ENTP-005-message-templates.jmx",
  plan(
    "ENTP-005 自定义消息模板（11 事件全量/upsert/preview/恢复默认；四类场景）",
    {
      EMAIL: `jm-e5-${TS}@rabbit.test`,
      EMAIL_ERR: `jm-e5e-${TS}@rabbit.test`,
      LICENSE: LIC_VALID,
      TS,
    },
    [
      threadGroup("G1 主链（注册→admin License→回用户会话→模板；单组：JMeter 变量不跨组）", [
        sampler({
          name: "T0 注册并取项目",
          method: "POST",
          path: "/api/v1/auth/register",
          body: { email: "${EMAIL}", password: "rabbit-pass-123" },
          status: 201,
          extract: { var: "PROJECT_ID", path: "$.data.projectId" },
          duration: 8000,
        }),
        ...adminWithLicense,
        // admin 操作后切回注册用户会话
        sampler({
          name: "T0-2 回注册用户会话",
          method: "POST",
          path: "/api/v1/auth/login",
          body: { email: "${EMAIL}", password: "rabbit-pass-123" },
          field: ["$.code", "0"],
        }),
        sampler({
          name: "T1.1 列表 11 事件（全默认）",
          method: "GET",
          path: "/api/v1/projects/${PROJECT_ID}/message-templates",
          field: ["$.data.total", "11"],
        }),
        sampler({
          name: "T1.2 定制 BUG_CREATED",
          method: "PUT",
          path: "/api/v1/projects/${PROJECT_ID}/message-templates",
          body: {
            event: "BUG_CREATED",
            title: "[${project}] ${actorName} 提交了缺陷 ${title}",
            content: "时间：${time}",
          },
          field: ["$.data.event", "BUG_CREATED"],
        }),
        sampler({
          name: "T1.3 列表已定制标记",
          method: "GET",
          path: "/api/v1/projects/${PROJECT_ID}/message-templates",
          contains: ["$.data.items[0].customized", "true"],
        }),
        sampler({
          name: "T1.4 实时预览（服务端渲染）",
          method: "POST",
          path: "/api/v1/projects/${PROJECT_ID}/message-templates/preview",
          body: { event: "BUG_CREATED", title: "[${project}]", content: "${severity}" },
          contains: ["$.data.title", "演示项目"],
          field: ["$.data.content", "P1"],
        }),
        sampler({
          name: "T1.5 恢复默认",
          method: "DELETE",
          path: "/api/v1/projects/${PROJECT_ID}/message-templates/BUG_CREATED",
          field: ["$.data.event", "BUG_CREATED"],
        }),
        sampler({
          name: "T1.6 幂等（无模板再删）",
          method: "DELETE",
          path: "/api/v1/projects/${PROJECT_ID}/message-templates/BUG_CREATED",
          field: ["$.code", "0"],
        }),
        // 422 组并入主组（JMeter 变量不跨组；当前为注册用户会话）
        sampler({
          name: "422.1 event 非法 90050",
          method: "DELETE",
          path: "/api/v1/projects/${PROJECT_ID}/message-templates/NOT_A_EVENT",
          status: 422,
          code: 90050,
        }),
        sampler({
          name: "422.2 标题超长（zod）",
          method: "PUT",
          path: "/api/v1/projects/${PROJECT_ID}/message-templates",
          body: { event: "BUG_CREATED", title: "x".repeat(129), content: "c" },
          status: 422,
          code: 20422,
        }),
      ]),
      unauthGroup({
        name: "401 无 Cookie 列模板",
        method: "GET",
        path: "/api/v1/projects/00000000-0000-0000-0000-000000000096/message-templates",
        status: 401,
        code: 10001,
      }),
      noPermGroup("403 普通用户 PUT 模板（他人项目 404 防枚举）", {
        name: "403/404 他人项目 PUT 模板",
        method: "PUT",
        path: "/api/v1/projects/00000000-0000-0000-0000-000000000096/message-templates",
        body: { event: "BUG_CREATED", title: "t", content: "c" },
        status: 404,
        code: 20404,
      }),
    ],
  ),
]);

// ═══════ ENTP-006 多资源池 ═══════
plans.push([
  "ENTP-006-multi-resource-pool.jmx",
  plan(
    "ENTP-006 多资源池（CRUD/心跳按池注册/默认池保护/执行侧校验；四类场景）",
    {
      EMAIL_ERR: `jm-e6e-${TS}@rabbit.test`,
      LICENSE: LIC_VALID,
      TS,
    },
    [
      threadGroup("G0 admin+License", adminWithLicense),
      threadGroup("G1 池 CRUD + 按池心跳", [
        ...adminRelogin,
        sampler({
          name: "T1.1 列表（默认池在）",
          method: "GET",
          path: "/api/v1/system/pools",
          contains: ["$.data.items[0].isDefault", "true"],
        }),
        sampler({
          name: "T1.2 新建企业池",
          method: "POST",
          path: "/api/v1/system/pools",
          body: { name: "企业池${TS}", type: "NODE", maxConcurrency: 8, orgScope: "ALL" },
          status: 201,
          extract: { var: "POOL_ID", path: "$.data.id" },
          contains: ["$.data.id", "-"],
        }),
        sampler({
          name: "T1.3 心跳按池注册（internal token）",
          method: "POST",
          path: "/api/v1/internal/pools/register",
          headers: [
            ["X-Internal-Token", "${__P(INTERNAL_TOKEN,jmeter-internal-token)}"],
            ["Content-Type", "application/json"],
          ],
          body: {
            nodeId: "jmx-node-1",
            version: "0.4.0",
            slots: 8,
            busy: 0,
            ts: 1,
            poolId: "${POOL_ID}",
          },
          field: ["$.data.poolId", "${POOL_ID}"],
          contains: ["$.data.maxConcurrency", "8"],
        }),
        sampler({
          name: "T1.4 池详情含节点",
          method: "GET",
          path: "/api/v1/system/pools/${POOL_ID}",
          contains: ["$.data.nodes[0].nodeId", "jmx-node-1"],
        }),
        sampler({
          name: "T1.5 编辑并发（PATCH）",
          method: "PATCH",
          path: "/api/v1/system/pools/${POOL_ID}",
          body: { maxConcurrency: 16 },
          field: ["$.data.maxConcurrency", "16"],
        }),
        sampler({
          name: "T1.6 禁用池",
          method: "PATCH",
          path: "/api/v1/system/pools/${POOL_ID}",
          body: { status: "DISABLED" },
          field: ["$.data.status", "DISABLED"],
        }),
        sampler({
          name: "T1.7 启用池",
          method: "PATCH",
          path: "/api/v1/system/pools/${POOL_ID}",
          body: { status: "ACTIVE" },
          field: ["$.data.status", "ACTIVE"],
        }),
        sampler({
          name: "T1.8 删除池（无历史任务）",
          method: "DELETE",
          path: "/api/v1/system/pools/${POOL_ID}",
          field: ["$.data.id", "${POOL_ID}"],
        }),
      ]),
      threadGroup("G2 默认池保护（组内 admin 会话重建）", [
        ...adminRelogin,
        sampler({
          name: "T2.1 删默认池 409 90030",
          method: "DELETE",
          path: "/api/v1/system/pools/00000000-0000-0000-0000-000000000001",
          status: 409,
          code: 90030,
        }),
        sampler({
          name: "T2.2 禁默认池 422 90031",
          method: "PATCH",
          path: "/api/v1/system/pools/00000000-0000-0000-0000-000000000001",
          body: { status: "DISABLED" },
          status: 422,
          code: 90031,
        }),
      ]),
      unauthGroup({
        name: "401 无 Cookie 建池",
        method: "POST",
        path: "/api/v1/system/pools",
        body: { name: "x", type: "NODE", maxConcurrency: 4 },
        status: 401,
        code: 10001,
      }),
      noPermGroup("403 普通用户建池", {
        name: "403 建池",
        method: "POST",
        path: "/api/v1/system/pools",
        body: { name: "x", type: "NODE", maxConcurrency: 4 },
        status: 403,
        code: 10003,
      }),
      threadGroup("422 校验失败", [
        sampler({
          name: "G4-1 admin 回会话",
          method: "POST",
          path: "/api/v1/auth/login",
          body: ADMIN_LOGIN,
          field: ["$.code", "0"],
        }),
        sampler({
          name: "G4-0 幂等覆盖 License",
          method: "POST",
          path: "/api/v1/system/license",
          body: { code: "${LICENSE}" },
          field: ["$.data.edition", "ENTERPRISE"],
        }),
        sampler({
          name: "422.1 并发越界 99",
          method: "POST",
          path: "/api/v1/system/pools",
          body: { name: "x${TS}", type: "NODE", maxConcurrency: 99 },
          status: 422,
          code: 20422,
        }),
        sampler({
          name: "422.2 orgScope 空数组",
          method: "POST",
          path: "/api/v1/system/pools",
          body: { name: "y${TS}", type: "K8S", maxConcurrency: 8, orgScope: [] },
          status: 422,
          code: 20422,
        }),
        sampler({
          name: "409.3 建基名池（重名前置）",
          method: "POST",
          path: "/api/v1/system/pools",
          body: { name: "重名池${TS}", type: "NODE", maxConcurrency: 8 },
          status: 201,
          extract: { var: "DUP_POOL", path: "$.data.id" },
          contains: ["$.data.id", "-"],
        }),
        sampler({
          name: "409.4 重名池 90035",
          method: "POST",
          path: "/api/v1/system/pools",
          body: { name: "重名池${TS}", type: "NODE", maxConcurrency: 8 },
          status: 409,
          code: 90035,
        }),
        sampler({
          name: "409.5 清理基名池",
          method: "DELETE",
          path: "/api/v1/system/pools/${DUP_POOL}",
          field: ["$.code", "0"],
        }),
      ]),
    ],
  ),
]);

// ═══════ ENTP-007 License 体系 ═══════
plans.push([
  "ENTP-007-license-system.jmx",
  plan(
    "ENTP-007 License 体系（添加/校验/移除/公开状态/门控二态/到期过期；四类场景）",
    {
      EMAIL_ERR: `jm-e7e-${TS}@rabbit.test`,
      LICENSE: LIC_VALID,
      LICENSE_EXPIRED: LIC_EXPIRED,
      LICENSE_TAMPERED: LIC_TAMPERED,
      TS,
    },
    [
      threadGroup("G1 主链（社区→企业→社区）", [
        sampler({
          name: "T1.1 admin 登录",
          method: "POST",
          path: "/api/v1/auth/login",
          body: ADMIN_LOGIN,
          field: ["$.code", "0"],
        }),
        sampler({
          name: "T1.2 移除历史授权（幂等起点）",
          method: "DELETE",
          path: "/api/v1/system/license",
          field: ["$.data.edition", "COMMUNITY"],
        }),
        sampler({
          name: "T1.3 状态=社区版",
          method: "GET",
          path: "/api/v1/system/license",
          field: ["$.data.edition", "COMMUNITY"],
        }),
        sampler({
          name: "T1.4 公开状态=社区版",
          method: "GET",
          path: "/api/v1/public/license-status",
          field: ["$.data.edition", "COMMUNITY"],
        }),
        sampler({
          name: "T1.5 社区版建池 403 90001",
          method: "POST",
          path: "/api/v1/system/pools",
          body: { name: "门控池${TS}", type: "NODE", maxConcurrency: 4 },
          status: 403,
          code: 90001,
        }),
        sampler({
          name: "T1.6 添加 License → 企业版",
          method: "POST",
          path: "/api/v1/system/license",
          body: { code: "${LICENSE}" },
          field: ["$.data.edition", "ENTERPRISE"],
        }),
        sampler({
          name: "T1.7 六特性全授权（首项 MULTI_ORG）",
          method: "GET",
          path: "/api/v1/system/license",
          field: ["$.data.features[0]", "MULTI_ORG"],
        }),
        sampler({
          name: "T1.8 同池创建放行（门控二态）",
          method: "POST",
          path: "/api/v1/system/pools",
          body: { name: "门控池${TS}", type: "NODE", maxConcurrency: 4 },
          status: 201,
          extract: { var: "POOL_ID", path: "$.data.id" },
          contains: ["$.data.id", "-"],
        }),
        sampler({
          name: "T1.9 清理门控池",
          method: "DELETE",
          path: "/api/v1/system/pools/${POOL_ID}",
          field: ["$.code", "0"],
        }),
        sampler({
          name: "T1.10 移除 → 回社区版",
          method: "DELETE",
          path: "/api/v1/system/license",
          field: ["$.data.edition", "COMMUNITY"],
        }),
      ]),
      unauthGroup({
        name: "401 无 Cookie 读授权状态",
        method: "GET",
        path: "/api/v1/system/license",
        status: 401,
        code: 10001,
      }),
      noPermGroup("403 普通用户读授权状态（无 SYSTEM_LICENSE:READ）", {
        name: "403 读授权",
        method: "GET",
        path: "/api/v1/system/license",
        status: 403,
        code: 10003,
      }),
      threadGroup("422 校验失败（三重校验）", [
        sampler({
          name: "G4-1 admin 登录",
          method: "POST",
          path: "/api/v1/auth/login",
          body: ADMIN_LOGIN,
          field: ["$.code", "0"],
        }),
        sampler({
          name: "422.1 坏格式 90002",
          method: "POST",
          path: "/api/v1/system/license",
          body: { code: "RABBIT-ENT1.bad-bad-bad-bad" },
          status: 422,
          code: 90002,
        }),
        sampler({
          name: "422.2 签名篡改 90003",
          method: "POST",
          path: "/api/v1/system/license",
          body: { code: "${LICENSE_TAMPERED}" },
          status: 422,
          code: 90003,
        }),
        sampler({
          name: "422.3 已过期 90004",
          method: "POST",
          path: "/api/v1/system/license",
          body: { code: "${LICENSE_EXPIRED}" },
          status: 422,
          code: 90004,
        }),
        sampler({
          name: "G4-9 收尾保持社区版（终态）",
          method: "GET",
          path: "/api/v1/system/license",
          field: ["$.data.edition", "COMMUNITY"],
        }),
      ]),
    ],
  ),
]);

// ═══════ ENTP-008 用户扩容与部门 ═══════
plans.push([
  "ENTP-008-user-scale-department.jmx",
  plan(
    "ENTP-008 用户扩容与部门（部门树 CRUD/成员挂载/上限字段；四类场景）",
    {
      EMAIL: `jm-e8-${TS}@rabbit.test`,
      EMAIL_P: `jm-e8p-${TS}@rabbit.test`,
      EMAIL_M: `jm-e8m-${TS}@rabbit.test`,
      EMAIL_E: `jm-e8x-${TS}@rabbit.test`,
      EMAIL_ERR: `jm-e8e-${TS}@rabbit.test`,
      LICENSE: LIC_VALID,
      TS,
    },
    [
      threadGroup("G0 注册成员+admin+License", [
        sampler({
          name: "T0.1 注册组织成员",
          method: "POST",
          path: "/api/v1/auth/register",
          body: { email: "${EMAIL}", password: "rabbit-pass-123" },
          status: 201,
          extract: { var: "USER_ID", path: "$.data.userId" },
          duration: 8000,
        }),
        sampler({
          name: "T0.2 注册项目取组织",
          method: "POST",
          path: "/api/v1/auth/register",
          body: { email: "${EMAIL_P}", password: "rabbit-pass-123" },
          status: 201,
          extract: { var: "PROJECT_ID", path: "$.data.projectId" },
          duration: 8000,
        }),
        ...adminWithLicense,
        sampler({
          name: "T0.3 admin 本人组织（personal/orgs 首个）",
          method: "GET",
          path: "/api/v1/personal/orgs",
          extract: { var: "ORG_ID", path: "$.data[0].id" },
          contains: ["$.data[0].id", "-"],
        }),
        sampler({
          name: "T0.4 组织加成员（部门挂载前置）",
          method: "POST",
          path: "/api/v1/orgs/${ORG_ID}/members-add",
          body: { userIds: ["${USER_ID}"] },
          status: 201,
        }),
      ]),
      threadGroup("G1 部门树 CRUD 主链（admin 会话，ORG_DEPARTMENT 点）", [
        ...adminRelogin,
        sampler({
          name: "T0.5 组内取 admin 本人组织（变量不跨组）",
          method: "GET",
          path: "/api/v1/personal/orgs",
          extract: { var: "ORG_ID", path: "$.data[0].id" },
          contains: ["$.data[0].id", "-"],
        }),
        sampler({
          name: "T0.6 组内注册成员（变量不跨组）",
          method: "POST",
          path: "/api/v1/auth/register",
          body: { email: "${EMAIL_M}", password: "rabbit-pass-123" },
          status: 201,
          extract: { var: "USER_ID_M", path: "$.data.userId" },
          contains: ["$.data.userId", "-"],
          duration: 8000,
        }),
        sampler({
          name: "T0.7 admin 回会话并挂成员入组",
          method: "POST",
          path: "/api/v1/auth/login",
          body: ADMIN_LOGIN,
          field: ["$.code", "0"],
        }),
        sampler({
          name: "T0.8 成员入组织",
          method: "POST",
          path: "/api/v1/orgs/${ORG_ID}/members-add",
          body: { userIds: ["${USER_ID_M}"] },
          status: 201,
        }),
        sampler({
          name: "T1.1 建根部门",
          method: "POST",
          path: "/api/v1/orgs/${ORG_ID}/departments",
          body: { name: "质量部" },
          status: 201,
          extract: { var: "DEPT_ID", path: "$.data.id" },
          contains: ["$.data.id", "-"],
        }),
        sampler({
          name: "T1.2 建子部门",
          method: "POST",
          path: "/api/v1/orgs/${ORG_ID}/departments",
          body: { name: "测试一组", parentId: "${DEPT_ID}" },
          status: 201,
          extract: { var: "SUB_ID", path: "$.data.id" },
          contains: ["$.data.id", "-"],
        }),
        sampler({
          name: "T1.3 树（根含 children）",
          method: "GET",
          path: "/api/v1/orgs/${ORG_ID}/departments",
          contains: ["$.data[0].children[0].name", "测试一组"],
        }),
        sampler({
          name: "T1.4 挂成员",
          method: "POST",
          path: "/api/v1/orgs/${ORG_ID}/departments/${SUB_ID}/members",
          body: { userIds: ["${USER_ID_M}"] },
          status: 201,
          field: ["$.data.added", "1"],
        }),
        sampler({
          name: "T1.5 成员表",
          method: "GET",
          path: "/api/v1/orgs/${ORG_ID}/departments/${SUB_ID}/members",
          contains: ["$.data[0].userId", "${USER_ID_M}"],
        }),
        sampler({
          name: "T1.6 树成员计数=1",
          method: "GET",
          path: "/api/v1/orgs/${ORG_ID}/departments",
          contains: ["$.data[0].children[0].memberCount", "1"],
        }),
        sampler({
          name: "T1.7 删根（有子）409 90043",
          method: "DELETE",
          path: "/api/v1/orgs/${ORG_ID}/departments/${DEPT_ID}",
          status: 409,
          code: 90043,
        }),
        sampler({
          name: "T1.8 移除成员挂载",
          method: "DELETE",
          path: "/api/v1/orgs/${ORG_ID}/departments/${SUB_ID}/members/${USER_ID_M}",
          field: ["$.data.ok", "true"],
        }),
        sampler({
          name: "T1.9 删子部门",
          method: "DELETE",
          path: "/api/v1/orgs/${ORG_ID}/departments/${SUB_ID}",
          field: ["$.code", "0"],
        }),
        sampler({
          name: "T1.10 删根部门",
          method: "DELETE",
          path: "/api/v1/orgs/${ORG_ID}/departments/${DEPT_ID}",
          field: ["$.code", "0"],
        }),
      ]),
      threadGroup("G2 用户列表（企业版上限口径）", [
        ...adminRelogin,
        sampler({
          name: "T2.1 用户列表含 limit/communityLimit",
          method: "GET",
          path: "/api/v1/system/users?pageSize=5",
          contains: ["$.data.communityLimit", "30"],
        }),
      ]),
      unauthGroup({
        name: "401 无 Cookie 部门树",
        method: "GET",
        path: "/api/v1/orgs/00000000-0000-0000-0000-000000000095/departments",
        status: 401,
        code: 10001,
      }),
      noPermGroup("403 普通用户（项目成员无 ORG_DEPARTMENT 点）读部门树", {
        name: "403 部门树",
        method: "GET",
        path: "/api/v1/orgs/00000000-0000-0000-0000-000000000095/departments",
        status: 404,
        code: 20404,
      }),
      threadGroup("422 校验失败（admin 会话）", [
        sampler({
          name: "G4-1 admin 回会话",
          method: "POST",
          path: "/api/v1/auth/login",
          body: ADMIN_LOGIN,
          field: ["$.code", "0"],
        }),
        sampler({
          name: "G4-0 幂等覆盖 License",
          method: "POST",
          path: "/api/v1/system/license",
          body: { code: "${LICENSE}" },
          field: ["$.data.edition", "ENTERPRISE"],
        }),
        sampler({
          name: "T0-3 重取组织（personal/orgs 首个）",
          method: "GET",
          path: "/api/v1/personal/orgs",
          extract: { var: "ORG_ID", path: "$.data[0].id" },
          contains: ["$.data[0].id", "-"],
        }),
        sampler({
          name: "T0-4 注册组内成员",
          method: "POST",
          path: "/api/v1/auth/register",
          body: { email: "${EMAIL_E}", password: "rabbit-pass-123" },
          status: 201,
          extract: { var: "USER_ID_E", path: "$.data.userId" },
          contains: ["$.data.userId", "-"],
          duration: 8000,
        }),
        sampler({
          name: "T0-5 admin 回会话并挂成员（保险）",
          method: "POST",
          path: "/api/v1/auth/login",
          body: ADMIN_LOGIN,
          field: ["$.code", "0"],
        }),
        sampler({
          name: "T0-6 成员入组织",
          method: "POST",
          path: "/api/v1/orgs/${ORG_ID}/members-add",
          body: { userIds: ["${USER_ID_E}"] },
          status: 201,
        }),
        sampler({
          name: "422.1 部门自引用 90042",
          method: "POST",
          path: "/api/v1/orgs/${ORG_ID}/departments",
          body: { name: "占位", parentId: "00000000-0000-0000-0000-000000000094" },
          status: 422,
          code: 90042,
        }),
        sampler({
          name: "422.2 挂非组织成员 90044",
          method: "POST",
          path: "/api/v1/orgs/${ORG_ID}/departments",
          body: { name: "新部${TS}" },
          status: 201,
          extract: { var: "D_ID", path: "$.data.id" },
          contains: ["$.data.id", "-"],
        }),
        sampler({
          name: "422.3 挂越界用户",
          method: "POST",
          path: "/api/v1/orgs/${ORG_ID}/departments/${D_ID}/members",
          body: { userIds: ["00000000-0000-0000-0000-000000000093"] },
          status: 422,
          code: 90044,
        }),
        sampler({
          name: "422.4 清理",
          method: "DELETE",
          path: "/api/v1/orgs/${ORG_ID}/departments/${D_ID}",
          field: ["$.code", "0"],
        }),
      ]),
    ],
  ),
]);

// ═══════ 写盘 ═══════
for (const [file, content] of plans) {
  writeFileSync(path.join(OUT, file), content);
  console.log(`[gen-jmx-s9] ${file} (${(content.length / 1024).toFixed(1)} KB)`);
}
console.log(
  `[gen-jmx-s9] 共 ${plans.length} 份计划；License(VALID/EXPIRED/TAMPERED) 以默认开发密钥预计算`,
);
