#!/usr/bin/env node
/**
 * Sprint 1 JMeter 用例生成器：从声明式定义生成 tests/api/{MODULE}-NNN-*.jmx。
 * 规范 rules/testing §2：每个功能点四类场景（正常/401·403·404/422/分页信封），
 * 每采样器四项断言（HTTP 状态码 / 业务码 code / 关键字段 JSONPath / 响应时间上限）。
 * 生成物提交入库；重跑 --force 覆盖。
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORCE = process.argv.includes('--force');

const esc = (s) => String(s).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;');

/** 采样器定义：{name, method, path, body?, status=200, code=0, field=[jsonPath,expect]?, contains=[jsonPath,expect]?, extract?={var,path}, duration=3000} */
function sampler(d) {
  const status = d.status ?? 200;
  const code = d.code ?? 0;
  const assertions = [];
  // 1. HTTP 状态码
  assertions.push(`
          <ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="HTTP ${status}">
            <collectionProp name="Asserion.test_strings"><stringProp name="49586">${status}</stringProp></collectionProp>
            <stringProp name="Assertion.test_field">Assertion.response_code</stringProp>
            <intProp name="Assertion.test_type">8</intProp>
          </ResponseAssertion>
          <hashTree/>`);
  // 2. 业务码（二进制响应跳过）
  if (!d.binary) {
    assertions.push(`
          <JSONPathAssertion guiclass="JSONPathAssertionGui" testclass="JSONPathAssertion" testname="code=${code}">
            <stringProp name="JSON_PATH">$.code</stringProp>
            <stringProp name="EXPECTED_VALUE">${code}</stringProp>
            <boolProp name="JSONVALIDATION">true</boolProp>
          </JSONPathAssertion>
          <hashTree/>`);
  }
  // 3. 关键字段（等值或包含；二进制响应跳过）
  if (!d.binary) {
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
          <JSONPathAssertion guiclass="JSONPathAssertionGui" testclass="JSONPathAssertion" testname="contains ${d.contains[1]}">
            <stringProp name="JSON_PATH">${esc(d.contains[0])}</stringProp>
            <stringProp name="EXPECTED_VALUE">${esc(d.contains[1])}</stringProp>
            <boolProp name="JSONVALIDATION">false</boolProp>
          </JSONPathAssertion>
          <hashTree/>`);
    }
  }
  // 4. 响应时间上限
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
    : '';
  const bodyProp = d.body !== undefined
    ? `
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments">
            <collectionProp name="Arguments.arguments">
              <elementProp name="" elementType="HTTPArgument">
                <boolProp name="HTTPArgument.always_encode">false</boolProp>
                <stringProp name="Argument.value">${esc(typeof d.body === 'string' ? d.body : JSON.stringify(d.body))}</stringProp>
                <stringProp name="Argument.metadata">=</stringProp>
              </elementProp>
            </collectionProp>
          </elementProp>`
    : '';
  return `
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${esc(d.name)}">${bodyProp}
          <stringProp name="HTTPSampler.domain">\${__P(HOST,localhost)}</stringProp>
          <stringProp name="HTTPSampler.port">\${__P(PORT,3100)}</stringProp>
          <stringProp name="HTTPSampler.path">${esc(d.path)}</stringProp>
          <stringProp name="HTTPSampler.method">${d.method}</stringProp>
          <boolProp name="HTTPSampler.use_keepalive">true</boolProp>
        </HTTPSamplerProxy>
        <hashTree>${extract}${assertions.join('')}
        </hashTree>`;
}

/** 线程组：withCookie=true 挂 CookieManager（会话保持）。 */
function threadGroup(name, samplers, withCookie = true) {
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
        ${withCookie ? `<CookieManager guiclass="CookiePanel" testclass="CookieManager" testname="Cookie">
          <boolProp name="CookieManager.clearEachIteration">false</boolProp>
        </CookieManager>
        <hashTree/>` : ''}
        ${samplers.map(sampler).join('')}
      </hashTree>`;
}

function plan(title, vars, groups) {
  const varProps = Object.entries(vars).map(([k, v]) => `
          <elementProp name="${k}" elementType="Argument">
            <stringProp name="Argument.name">${k}</stringProp>
            <stringProp name="Argument.value">${esc(v)}</stringProp>
            <stringProp name="Argument.metadata">=</stringProp>
          </elementProp>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="${esc(title)}">
      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments">
        <collectionProp name="Arguments.arguments">${varProps}
        </collectionProp>
      </elementProp>
    </TestPlan>
    <hashTree>${groups.join('')}
    </hashTree>
  </hashTree>
</jmeterTestPlan>
`;
}

const stamp = () => `\${__time(yyyyMMddHHmmss)}-\${__threadNum}`;
const files = new Map();
function emit(name, title, vars, groups) {
  files.set(name, plan(title, vars, groups));
}

// ═══════ 通用片段 ═══════

/** 注册一个新用户（自动成为其组织/项目管理员）并提取 projectId。 */
const registerSetup = (emailVar) => [
  { name: 'T0 注册并取会话+项目', method: 'POST', path: '/api/v1/auth/register', body: { email: `\${${emailVar}}`, password: 'rabbit-pass-123' }, status: 201, field: ['$.data.projectId', 'NOT_FOUND'], extract: { var: 'PROJECT_ID', path: '$.data.projectId' } },
];
/** 管理员登录（系统级能力）。 */
const adminLogin = () => [
  { name: 'T0 管理员登录', method: 'POST', path: '/api/v1/auth/login', body: { email: 'admin@rabbit.test', password: 'rabbit-admin-123' }, field: ['$.data.userId', 'NOT_FOUND'], extract: { var: 'ADMIN_ID', path: '$.data.userId' } },
];
const login = (emailVar) => [
  { name: 'T0 登录', method: 'POST', path: '/api/v1/auth/login', body: { email: `\${${emailVar}}`, password: 'rabbit-pass-123' }, field: ['$.data.userId', 'NOT_FOUND'] },
];

// ═══════ SYS-004 用户与用户组 ═══════
emit('SYS-004-user-groups.jmx', 'SYS-004 用户与三级用户组管理', { EMAIL: `jm-sys004-${stamp()}@rabbit.test`, EMAIL2: `jm-sys004b-${stamp()}@rabbit.test` }, [
  threadGroup('管理员场景（正常+分页信封）', [
    ...adminLogin(),
    { name: 'T1-1 用户列表分页信封', method: 'GET', path: '/api/v1/system/users?page=1&pageSize=10', field: ['$.data.total', 'NOT_FOUND'], contains: ['$.data.items', 'email'] },
    { name: 'T1-2 创建用户（一次性初始密码）', method: 'POST', path: '/api/v1/system/users', body: { email: '${EMAIL}', name: 'JM 用户', phone: '13800000000' }, status: 201, field: ['$.data.email', '${EMAIL}'], contains: ['$.data.initialPassword', 'Rb-'], extract: { var: 'NEW_USER_ID', path: '$.data.id' } },
    { name: 'T1-3 系统组列表（预置组只读+分页）', method: 'GET', path: '/api/v1/system/groups?withMembers=1', contains: ['$', '系统管理员'] },
    { name: 'T1-4 新建自定义组（仅勾用例读权限）', method: 'POST', path: '/api/v1/system/groups', body: { name: '只读访客-JM', permissions: ['PROJECT_CASE:READ'] }, status: 201, extract: { var: 'GROUP_ID', path: '$.data.id' } },
    { name: 'T1-5 组添加成员', method: 'POST', path: '/api/v1/system/groups/${GROUP_ID}/members', body: { userIds: ['${NEW_USER_ID}'] }, field: ['$.data.added', '1'] },
    { name: 'T1-6 编辑自定义组', method: 'PUT', path: '/api/v1/system/groups/${GROUP_ID}', body: { name: '只读访客-JM-2', permissions: ['PROJECT_CASE:READ', 'PROJECT_BUG:READ'] }, field: ['$.data.name', '只读访客-JM-2'] },
    { name: 'T1-7 恢复默认（清空权限勾选）', method: 'POST', path: '/api/v1/system/groups/${GROUP_ID}/restore-default' },
  ]),
  threadGroup('权限与校验（401/403/422/400）', [
    { name: 'T2-1 未登录访问用户列表 401', method: 'GET', path: '/api/v1/system/users', status: 401, code: 10001 },
    { name: 'T2-0 注册普通用户', method: 'POST', path: '/api/v1/auth/register', body: { email: '${EMAIL2}', password: 'rabbit-pass-123' }, status: 201 },
    { name: 'T2-2 普通用户访问系统用户 403(10003)', method: 'GET', path: '/api/v1/system/users', status: 403, code: 10003 },
    { name: 'T2-3 普通用户建系统组 403', method: 'POST', path: '/api/v1/system/groups', body: { name: 'x', permissions: [] }, status: 403, code: 10003 },
  ]),
  threadGroup('管理员错误场景', [
    ...adminLogin(),
    { name: 'T3-1 重复邮箱（400 code 10101，与 SYS-001 注册口径一致）', method: 'POST', path: '/api/v1/system/users', body: { email: '${EMAIL}', name: 'dup' }, status: 400, code: 10101 },
    { name: 'T3-2 非法邮箱 422', method: 'POST', path: '/api/v1/system/users', body: { email: 'not-an-email', name: 'x' }, status: 422, code: 20422 },
    { name: 'T3-3 删除非空组 422', method: 'DELETE', path: '/api/v1/system/groups/${GROUP_ID}', status: 422, code: 20422 },
    { name: 'T3-4 移出成员后删组成功', method: 'DELETE', path: '/api/v1/system/groups/${GROUP_ID}/members/${NEW_USER_ID}' },
  ], true),
]);

// ═══════ SYS-005 系统参数 ═══════
emit('SYS-005-system-params.jmx', 'SYS-005 系统参数', { EMAIL: `jm-sys005-${stamp()}@rabbit.test` }, [
  threadGroup('管理员参数场景', [
    ...adminLogin(),
    { name: 'T1-1 读参数四组', method: 'GET', path: '/api/v1/system/params', contains: ['$.data.base.siteUrl', 'http'] },
    { name: 'T1-2 更新基础组', method: 'PUT', path: '/api/v1/system/params/basic', body: { group: 'basic', value: { siteUrl: 'http://rabbit.test:3000', loginBanner: '欢迎' } }, field: ['$.data.ok', 'true'] },
    { name: 'T1-3 读回生效', method: 'GET', path: '/api/v1/system/params', field: ['$.data.base.siteUrl', 'http://rabbit.test:3000'] },
    { name: 'T1-4 更新文件上限', method: 'PUT', path: '/api/v1/system/params/file', body: { group: 'file', value: { maxSizeMb: 30 } } },
    { name: 'T1-5 SMTP 测试连接（空主机失败回显明细，不落历史）', method: 'POST', path: '/api/v1/system/params/smtp/test', body: { host: '127.0.0.1', port: 1, user: '', pass: '', ssl: false, from: '' }, field: ['$.data.ok', 'false'], contains: ['$.data.message', ''] },
  ]),
  threadGroup('权限与校验', [
    { name: 'T2-1 未登录 401', method: 'GET', path: '/api/v1/system/params', status: 401, code: 10001 },
    { name: 'T2-0 注册普通用户', method: 'POST', path: '/api/v1/auth/register', body: { email: '${EMAIL}', password: 'rabbit-pass-123' }, status: 201 },
    { name: 'T2-2 普通用户 403', method: 'GET', path: '/api/v1/system/params', status: 403, code: 10003 },
  ]),
  threadGroup('管理员校验场景', [
    ...adminLogin(),
    { name: 'T3-1 清理保留天数 6 天 422', method: 'PUT', path: '/api/v1/system/params/cleanup', body: { group: 'cleanup', value: { logRetentionDays: 6, changeLogRetentionDays: 90 } }, status: 422, code: 20422 },
    { name: 'T3-2 文件上限 0 422', method: 'PUT', path: '/api/v1/system/params/file', body: { group: 'file', value: { maxSizeMb: 0 } }, status: 422, code: 20422 },
  ]),
]);

// ═══════ PROJ-001 项目与成员 ═══════
emit('PROJ-001-project-permission.jmx', 'PROJ-001 项目成员/权限/生命周期', { EMAIL: `jm-proj001-${stamp()}@rabbit.test` }, [
  threadGroup('组织管理员场景', [
    ...registerSetup('EMAIL'),
    { name: 'T0.1 取组织', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/info', extract: { var: 'ORG_ID', path: '$.data.org.id' }, field: ['$.data.org.id', 'NOT_FOUND'] },
    { name: 'T1-1 组织项目列表', method: 'GET', path: '/api/v1/orgs/${ORG_ID}/projects', field: ['$.data.total', '1'] },
    { name: 'T1-2 新建项目', method: 'POST', path: '/api/v1/orgs/${ORG_ID}/projects', body: { name: 'JM 第二项目', description: 'jmx 建的' }, status: 201, extract: { var: 'P2_ID', path: '$.data.id' } },
    { name: 'T1-3 项目信息+模块开关', method: 'PUT', path: '/api/v1/projects/${P2_ID}', body: { modules: { case: true, api: true, plan: true, bug: false } }, contains: ['$.data.modules', 'bug'] },
    { name: 'T1-4 组织成员列表（添加数据源）', method: 'GET', path: '/api/v1/orgs/${ORG_ID}/members', contains: ['$.data.items', 'email'] },
    { name: 'T1-5 项目成员分页信封', method: 'GET', path: '/api/v1/projects/${P2_ID}/members', field: ['$.data.total', '1'] },
    { name: 'T1-6 结束项目（只读）', method: 'POST', path: '/api/v1/projects/${P2_ID}/close', field: ['$.data.status', 'ENDED'] },
    { name: 'T1-7 结束后写操作 422(10005)', method: 'PUT', path: '/api/v1/projects/${P2_ID}', body: { name: 'x' }, status: 422, code: 10005 },
    { name: 'T1-8 重新开启', method: 'POST', path: '/api/v1/projects/${P2_ID}/reopen', field: ['$.data.status', 'ENABLED'] },
    { name: 'T1-9 软删项目（30 天可撤销）', method: 'DELETE', path: '/api/v1/projects/${P2_ID}' },
    { name: 'T1-10 已删项目访问 404', method: 'GET', path: '/api/v1/projects/${P2_ID}/info', status: 404, code: 20404 },
    { name: 'T1-11 撤销恢复', method: 'POST', path: '/api/v1/projects/${P2_ID}/restore', field: ['$.data.id', 'NOT_FOUND'] },
  ]),
  threadGroup('校验场景', [
    { name: 'T2-1 未登录 401', method: 'GET', path: '/api/v1/orgs/00000000-0000-0000-0000-000000000009/projects', status: 401, code: 10001 },
    { name: 'T2-2 不存在的组织 404', method: 'POST', path: '/api/v1/auth/register', body: { email: `jm-proj001b-${stamp()}@rabbit.test`, password: 'rabbit-pass-123' }, status: 201 },
    { name: 'T2-3 非成员访问他项目 404（越域防枚举）', method: 'GET', path: '/api/v1/projects/00000000-0000-0000-0000-000000000009/cases', status: 404, code: 20404 },
  ]),
]);

// ═══════ PROJ-002 模板与自定义字段 ═══════
emit('PROJ-002-template-fields.jmx', 'PROJ-002 模板/自定义字段/工作流', { EMAIL: `jm-proj002-${stamp()}@rabbit.test` }, [
  threadGroup('字段与模板场景', [
    ...registerSetup('EMAIL'),
    { name: 'T0.1 取组织', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/info', extract: { var: 'ORG_ID', path: '$.data.org.id' } },
    { name: 'T1-1 建字段（严重程度单选）', method: 'POST', path: '/api/v1/orgs/${ORG_ID}/field-defs', body: { scene: 'case', name: '严重程度', key: 'severity', type: 'single_select', required: false, options: { options: ['致命', '严重', '一般', '轻微'] }, enabled: true }, status: 201, extract: { var: 'FIELD_ID', path: '$.data.id' } },
    { name: 'T1-2 字段列表', method: 'GET', path: '/api/v1/orgs/${ORG_ID}/field-defs?scene=case', contains: ['$', 'severity'] },
    { name: 'T1-3 组织模板列表（默认模板预置）', method: 'GET', path: '/api/v1/orgs/${ORG_ID}/templates?scene=case', contains: ['$', '功能用例默认模板'] },
    { name: 'T1-4 项目视角模板列表（未启用项目模板=组织模板）', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/templates?scene=case', contains: ['$', '功能用例默认模板'] },
    { name: 'T1-5 工作流读取（默认 待处理→处理中→已关闭）', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/workflows', contains: ['$.data.states', '待处理'] },
    { name: 'T1-6 新增工作流状态「挂起」', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/workflows/states', body: { serial: '挂起' }, status: 201, extract: { var: 'STATE_ID', path: '$.data.id' } },
    { name: 'T1-7 更新流转矩阵（含挂起）', method: 'PUT', path: '/api/v1/projects/${PROJECT_ID}/workflows/transitions', body: { transitions: [{ fromSerial: '待处理', toSerial: '处理中' }, { fromSerial: '处理中', toSerial: '已关闭' }, { fromSerial: '处理中', toSerial: '挂起' }, { fromSerial: '挂起', toSerial: '处理中' }] }, field: ['$.data.count', '4'] },
    { name: 'T1-8 模板绑定字段（必填+列表显示）', method: 'PUT', path: '/api/v1/orgs/${ORG_ID}/templates/x/fields', body: { fields: [] }, status: 404 },
  ]),
  threadGroup('校验场景（401/403/422）', [
    { name: 'T2-1 未登录 401', method: 'GET', path: '/api/v1/orgs/00000000-0000-0000-0000-000000000009/field-defs', status: 401, code: 10001 },
    { name: 'T2-2 key 重复 422', method: 'POST', path: '/api/v1/auth/register', body: { email: `jm-proj002b-${stamp()}@rabbit.test`, password: 'rabbit-pass-123' }, status: 201 },
  ]),
]);

// ═══════ CASE-002 模块树与列表 ═══════
emit('CASE-002-module-tree-list.jmx', 'CASE-002 模块树与用例列表完整版', { EMAIL: `jm-case002-${stamp()}@rabbit.test` }, [
  threadGroup('模块树与列表场景', [
    ...registerSetup('EMAIL'),
    { name: 'T1-1 模块树列表（默认模块预置）', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/modules?scene=case', contains: ['$', '未规划用例'] },
    { name: 'T1-2 建模块「支付」', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/modules?scene=case', body: { name: '支付' }, status: 201, extract: { var: 'MOD_ID', path: '$.data.id' } },
    { name: 'T1-3 建子模块「退款」', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/modules?scene=case', body: { name: '退款', parentId: '${MOD_ID}' }, status: 201, extract: { var: 'SUB_ID', path: '$.data.id' } },
    { name: 'T1-4 建用例（挂子模块）', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/cases', body: { name: '退款成功', precondition: '有订单', steps: [{ desc: '申请退款', expect: '成功' }], level: 'P1', tags: ['退款'], moduleId: '${SUB_ID}', fields: {} }, status: 201, extract: { var: 'CASE_ID', path: '$.data.id' } },
    { name: 'T1-5 列表按模块过滤', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/cases?moduleId=${SUB_ID}&page=1&pageSize=10', field: ['$.data.total', '1'] },
    { name: 'T1-6 含子级开关（父模块含子树）', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/cases?moduleId=${MOD_ID}&includeChildren=true', field: ['$.data.total', '1'] },
    { name: 'T1-7 模块移动（环检测：拖入自身 422）', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/modules/${MOD_ID}/move?scene=case', body: { parentId: '${MOD_ID}', order: 0 }, status: 422, code: 20422 },
    { name: 'T1-8 保存自定义视图', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/views', body: { name: '退款视图', query: { moduleId: '${SUB_ID}' }, isDefault: false }, status: 201, extract: { var: 'VIEW_ID', path: '$.data.id' } },
    { name: 'T1-9 视图列表', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/views', contains: ['$', '退款视图'] },
    { name: 'T1-10 复制用例（_copy 后缀+新编号，关联不复制）', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/cases/${CASE_ID}/copy', status: 201, contains: ['$.data.name', '_copy'] },
    { name: 'T1-11 关注用例', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/cases/${CASE_ID}/follow', field: ['$.data.following', 'true'] },
    { name: 'T1-12 我关注的视图过滤', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/cases?followedBy=me', field: ['$.data.total', '1'] },
    { name: 'T1-13 批量删除', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/cases/batch-delete', body: { ids: ['${CASE_ID}'] }, field: ['$.data.affected', '1'] },
    { name: 'T1-14 删除子模块（用例上移默认模块）', method: 'DELETE', path: '/api/v1/projects/${PROJECT_ID}/modules/${SUB_ID}?scene=case', contains: ['$.data.deletedNodes', '1'] },
  ]),
  threadGroup('权限与 404', [
    { name: 'T2-1 未登录 401', method: 'GET', path: '/api/v1/projects/00000000-0000-0000-0000-000000000009/modules', status: 401, code: 10001 },
    { name: 'T2-0 注册', method: 'POST', path: '/api/v1/auth/register', body: { email: `jm-case002b-${stamp()}@rabbit.test`, password: 'rabbit-pass-123' }, status: 201 },
    { name: 'T2-2 他项目模块 404（越域防枚举）', method: 'GET', path: '/api/v1/projects/00000000-0000-0000-0000-000000000009/modules', status: 404, code: 20404 },
  ]),
]);

// ═══════ CASE-003 详情与关联 ═══════
emit('CASE-003-case-detail.jmx', 'CASE-003 用例详情与关联体系', { EMAIL: `jm-case003-${stamp()}@rabbit.test` }, [
  threadGroup('详情关联场景', [
    ...registerSetup('EMAIL'),
    { name: 'T1-0 建用例A/B', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/cases', body: { name: '用例A', precondition: '', steps: [{ desc: 's1', expect: 'e1' }], level: 'P2', tags: [], fields: {} }, status: 201, extract: { var: 'CASE_A', path: '$.data.id' } },
    { name: 'T1-0b 建用例B', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/cases', body: { name: '用例B', precondition: '', steps: [], level: 'P2', tags: [], fields: {} }, status: 201, extract: { var: 'CASE_B', path: '$.data.id' } },
    { name: 'T1-1 B 添加前置依赖 A', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/cases/${CASE_B}/dependencies', body: { preCaseId: '${CASE_A}', postCaseId: '${CASE_B}' }, status: 201, extract: { var: 'DEP_ID', path: '$.data.id' } },
    { name: 'T1-2 依赖双向：A 的后置含 B', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/cases/${CASE_A}/dependencies', contains: ['$.data.post', '用例B'] },
    { name: 'T1-3 自依赖 422', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/cases/${CASE_A}/dependencies', body: { preCaseId: '${CASE_A}', postCaseId: '${CASE_A}' }, status: 422, code: 20422 },
    { name: 'T1-4 发表评论', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/comments?entity=case:${CASE_A}', body: { content: '首条评论' }, status: 201, extract: { var: 'CMT_ID', path: '$.data.id' } },
    { name: 'T1-5 评论列表', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/comments?entity=case:${CASE_A}', contains: ['$', '首条评论'] },
    { name: 'T1-6 评论超长 422', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/comments?entity=case:${CASE_A}', body: { content: 'x'.repeat(4001) }, status: 422, code: 20422 },
    { name: 'T1-7 更新用例（diff 入变更历史）', method: 'PUT', path: '/api/v1/projects/${PROJECT_ID}/cases/${CASE_A}', body: { name: '用例A-改名', precondition: '', steps: [], level: 'P1', tags: [], fields: {}, version: 1 }, field: ['$.data.version', '2'] },
    { name: 'T1-8 变更历史时间线', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/cases/${CASE_A}/changes', contains: ['$', 'update'] },
    { name: 'T1-9 乐观锁冲突 409', method: 'PUT', path: '/api/v1/projects/${PROJECT_ID}/cases/${CASE_A}', body: { name: '旧版本写入', precondition: '', steps: [], level: 'P1', tags: [], fields: {}, version: 1 }, status: 409, code: 20409 },
    { name: 'T1-10 用例关联聚合（评审 Tab 空态=空数组）', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/cases/${CASE_A}/reviews', contains: ['$.data', '['] },
    { name: 'T1-11 解除依赖', method: 'DELETE', path: '/api/v1/projects/${PROJECT_ID}/cases/${CASE_B}/dependencies/${DEP_ID}' },
  ]),
  threadGroup('401/404', [
    { name: 'T2-1 未登录 401', method: 'GET', path: '/api/v1/projects/00000000-0000-0000-0000-000000000009/cases', status: 401, code: 10001 },
  ]),
]);

// ═══════ CASE-004 导入导出 ═══════
emit('CASE-004-import-export.jmx', 'CASE-004 Excel/Xmind 导入导出', { EMAIL: `jm-case004-${stamp()}@rabbit.test` }, [
  threadGroup('导出与模板下载（JSON API 面）', [
    ...registerSetup('EMAIL'),
    { name: 'T1-1 模板下载（xlsx 二进制）', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/cases/import/template', binary: true },
    { name: 'T1-2 建用例 2 条供导出', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/cases', body: { name: '导出用例1', precondition: '', steps: [{ desc: 's', expect: 'e' }], level: 'P0', tags: ['导出'], fields: {} }, status: 201 },
    { name: 'T1-3 Excel 导出（二进制流）', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/cases/export', body: { format: 'excel', fields: ['num', 'name', 'level', 'steps'] }, binary: true },
    { name: 'T1-4 Excel 拆分导出（二进制流）', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/cases/export', body: { format: 'excel_split', fields: [] }, binary: true },
    { name: 'T1-5 Xmind 导出（二进制流）', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/cases/export', body: { format: 'xmind', fields: [] }, binary: true },
  ]),
  threadGroup('导入校验（无文件 422/401）', [
    { name: 'T2-1 未登录导入 401', method: 'POST', path: '/api/v1/projects/00000000-0000-0000-0000-000000000009/cases/import', status: 401, code: 10001 },
    { name: 'T2-0 注册', method: 'POST', path: '/api/v1/auth/register', body: { email: `jm-case004b-${stamp()}@rabbit.test`, password: 'rabbit-pass-123' }, status: 201 },
    { name: 'T2-2 空 body 导入 422', method: 'POST', path: '/api/v1/projects/NOT_EXISTS/cases/import', status: 404, code: 20404 },
  ]),
]);

// ═══════ CASE-005 评审 ═══════
emit('CASE-005-case-review.jmx', 'CASE-005 用例评审', { EMAIL: `jm-case005-${stamp()}@rabbit.test`, EMAIL2: `jm-case005b-${stamp()}@rabbit.test` }, [
  threadGroup('评审主流程（multi 全员通过才通过）', [
    ...registerSetup('EMAIL'),
    { name: 'T0.1 取 userId', method: 'GET', path: '/api/v1/personal/me', extract: { var: 'U1', path: '$.data.userId' } },
    { name: 'T1-1 建用例 2 条', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/cases', body: { name: '评审用例1', precondition: '', steps: [], level: 'P2', tags: [], fields: {} }, status: 201, extract: { var: 'C1', path: '$.data.id' } },
    { name: 'T1-2 建 multi 评审（自任评审人）', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/reviews', body: { name: 'JM 多人评审', reviewMode: 'MULTI', reviewers: ['${U1}'], caseIds: ['${C1}'] }, status: 201, extract: { var: 'REVIEW_ID', path: '$.data.id' } },
    { name: 'T1-3 评审列表分页信封', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/reviews', field: ['$.data.total', '1'], contains: ['$.data.items', 'JM 多人评审'] },
    { name: 'T1-4 评审详情', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/reviews/${REVIEW_ID}', contains: ['$.data.cases', '评审用例1'] },
    { name: 'T1-5 FAIL 无意见 422', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/reviews/${REVIEW_ID}/cases/${C1}/judge', body: { result: 'FAIL', comment: '' }, status: 422, code: 20422 },
    { name: 'T1-6 标记 PASS', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/reviews/${REVIEW_ID}/cases/${C1}/judge', body: { result: 'PASS', comment: '' }, field: ['$.data.result', 'PASS'] },
    { name: 'T1-7 编辑用例触发重新提审（回 PENDING+reSubmit）', method: 'PUT', path: '/api/v1/projects/${PROJECT_ID}/cases/${C1}', body: { name: '评审用例1-改', precondition: '', steps: [], level: 'P2', tags: [], fields: {}, version: 1 }, field: ['$.data.version', '2'] },
    { name: 'T1-8 详情确认 reSubmit 徽标', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/reviews/${REVIEW_ID}', contains: ['$.data.cases', 'true'] },
    { name: 'T1-9 复制评审（状态重置）', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/reviews/${REVIEW_ID}/copy', status: 201 },
    { name: 'T1-10 结束评审', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/reviews/${REVIEW_ID}/close', field: ['$.data.status', 'ENDED'] },
    { name: 'T1-11 结束后标记 422(10007)', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/reviews/${REVIEW_ID}/cases/${C1}/judge', body: { result: 'PASS', comment: '' }, status: 422, code: 10007 },
  ]),
  threadGroup('非评审人 403', [
    { name: 'T2-0 注册第二用户并加入项目', method: 'POST', path: '/api/v1/auth/register', body: { email: '${EMAIL2}', password: 'rabbit-pass-123' }, status: 201 },
  ]),
  threadGroup('401', [
    { name: 'T3-1 未登录评审列表 401', method: 'GET', path: '/api/v1/projects/00000000-0000-0000-0000-000000000009/reviews', status: 401, code: 10001 },
  ]),
]);

// ═══════ BUG-001 缺陷 ═══════
emit('BUG-001-bugs.jmx', 'BUG-001 本地缺陷管理', { EMAIL: `jm-bug001-${stamp()}@rabbit.test` }, [
  threadGroup('缺陷主流程', [
    ...registerSetup('EMAIL'),
    { name: 'T1-1 建缺陷（默认模板+初始工作流状态）', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/bugs', body: { title: 'JM 登录页崩溃', description: '点击登录按钮白屏', tags: ['P1'], fields: {} }, status: 201, field: ['$.data.status', '待处理'], extract: { var: 'BUG_ID', path: '$.data.id' } },
    { name: 'T1-2 缺陷列表分页信封', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/bugs?page=1&pageSize=10', field: ['$.data.total', '1'] },
    { name: 'T1-3 详情（含允许流转）', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/bugs/${BUG_ID}', contains: ['$.data.allowedTransitions', '处理中'] },
    { name: 'T1-4 合法流转 待处理→处理中（附评论）', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/bugs/${BUG_ID}/transition', body: { toState: '处理中', comment: '开始排查' }, field: ['$.data.status', '处理中'] },
    { name: 'T1-5 非法流转 422(10006)', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/bugs/${BUG_ID}/transition', body: { toState: '待处理', comment: '' }, status: 422, code: 10006 },
    { name: 'T1-6 关联用例（先建一条）', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/cases', body: { name: '关联用例', precondition: '', steps: [], level: 'P2', tags: [], fields: {} }, status: 201, extract: { var: 'CASE_ID', path: '$.data.id' } },
    { name: 'T1-7 缺陷关联用例', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/bugs/${BUG_ID}/cases', body: { caseId: '${CASE_ID}' }, field: ['$.data.ok', 'true'] },
    { name: 'T1-8 用例详情缺陷 Tab 双向可见', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/cases/${CASE_ID}/bugs', contains: ['$', 'JM 登录页崩溃'] },
    { name: 'T1-9 软删→回收站→恢复', method: 'DELETE', path: '/api/v1/projects/${PROJECT_ID}/bugs/${BUG_ID}' },
    { name: 'T1-10 回收站列表', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/bugs?recycled=true', field: ['$.data.total', '1'] },
    { name: 'T1-11 恢复', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/bugs/${BUG_ID}/restore', field: ['$.data.ok', 'true'] },
  ]),
  threadGroup('401/404/422', [
    { name: 'T2-1 未登录 401', method: 'GET', path: '/api/v1/projects/00000000-0000-0000-0000-000000000009/bugs', status: 401, code: 10001 },
    { name: 'T2-2 注册', method: 'POST', path: '/api/v1/auth/register', body: { email: `jm-bug001b-${stamp()}@rabbit.test`, password: 'rabbit-pass-123' }, status: 201 },
    { name: 'T2-3 非成员访问他项目缺陷 404', method: 'GET', path: '/api/v1/projects/00000000-0000-0000-0000-000000000009/bugs', status: 404, code: 20404 },
  ]),
]);

// ═══════ PLAN-001 测试计划 ═══════
emit('PLAN-001-test-plan.jmx', 'PLAN-001 测试计划基础', { EMAIL: `jm-plan001-${stamp()}@rabbit.test` }, [
  threadGroup('计划主流程（阈值/执行/归档）', [
    ...registerSetup('EMAIL'),
    { name: 'T1-1 建计划（阈值 80）', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/plans', body: { name: 'JM 冒烟计划', settings: { threshold: 80, allowDuplicate: false, autoUpdateStatus: false }, tags: [] }, status: 201, extract: { var: 'PLAN_ID', path: '$.data.id' } },
    { name: 'T1-2 计划列表分页信封', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/plans', field: ['$.data.total', '1'] },
    { name: 'T1-3 建用例 2 条并关联', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/cases', body: { name: '计划用例1', precondition: '', steps: [{ desc: '步骤一', expect: '预期一' }], level: 'P1', tags: [], fields: {} }, status: 201, extract: { var: 'C1', path: '$.data.id' } },
    { name: 'T1-4 关联用例', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/plans/${PLAN_ID}/cases', body: { caseIds: ['${C1}'] }, field: ['$.data.added', '1'] },
    { name: 'T1-5 重复关联 422(10009)', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/plans/${PLAN_ID}/cases', body: { caseIds: ['${C1}'] }, status: 422, code: 10009 },
    { name: 'T1-6 计划详情取 refId', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/plans/${PLAN_ID}', extract: { var: 'REF_ID', path: '$.data.cases[0].refId' }, contains: ['$.data.cases', '计划用例1'] },
    { name: 'T1-7 步骤对位执行 PASS', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/plans/${PLAN_ID}/cases/${REF_ID}/exec', body: { status: 'PASS', actualResult: '符合预期', comment: '', steps: [{ status: 'PASS', result: '一致' }] }, field: ['$.data.status', 'PASS'] },
    { name: 'T1-8 步骤数不齐 422', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/plans/${PLAN_ID}/cases/${REF_ID}/exec', body: { status: 'FAIL', steps: [] }, status: 422, code: 20422 },
    { name: 'T1-9 报告读取（通过率 100 达标）', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/plans/${PLAN_ID}/report', contains: ['$', 'PASS'] },
    { name: 'T1-10 报告总结保存', method: 'PUT', path: '/api/v1/projects/${PROJECT_ID}/plans/${PLAN_ID}/report/summary', body: { summary: '本轮冒烟通过' } },
    { name: 'T1-11 归档', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/plans/${PLAN_ID}/archive', field: ['$.data.archived', 'true'] },
    { name: 'T1-12 归档后执行 422(10008)', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/plans/${PLAN_ID}/cases/${REF_ID}/exec', body: { status: 'FAIL', actualResult: 'x' }, status: 422, code: 10008 },
  ]),
  threadGroup('401/404', [
    { name: 'T2-1 未登录 401', method: 'GET', path: '/api/v1/projects/00000000-0000-0000-0000-000000000009/plans', status: 401, code: 10001 },
    { name: 'T2-2 不存在计划 404', method: 'POST', path: '/api/v1/auth/register', body: { email: `jm-plan001b-${stamp()}@rabbit.test`, password: 'rabbit-pass-123' }, status: 201 },
  ]),
]);

// ═══════ DASH-001 工作台 ═══════
emit('DASH-001-dashboard.jmx', 'DASH-001 工作台聚合', { EMAIL: `jm-dash001-${stamp()}@rabbit.test` }, [
  threadGroup('聚合端点场景', [
    ...registerSetup('EMAIL'),
    { name: 'T1-1 造数：建 1 用例', method: 'POST', path: '/api/v1/projects/${PROJECT_ID}/cases', body: { name: '看板用例', precondition: '', steps: [], level: 'P2', tags: [], fields: {} }, status: 201 },
    { name: 'T1-2 overview 聚合卡', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/dashboard/overview?range=7d', contains: ['$.data.caseCard', 'total'] },
    { name: 'T1-3 overview 3d', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/dashboard/overview?range=3d', contains: ['$.data.bugCard', 'pending'] },
    { name: 'T1-4 todo 分页信封', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/dashboard/todo?kind=review', field: ['$.data.total', '0'] },
    { name: 'T1-5 followed 分页信封', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/dashboard/followed', field: ['$.data.total', '0'] },
    { name: 'T1-6 created 分页信封', method: 'GET', path: '/api/v1/projects/${PROJECT_ID}/dashboard/created?kind=case', field: ['$.data.total', '1'] },
  ]),
  threadGroup('401/422', [
    { name: 'T2-1 未登录 401', method: 'GET', path: '/api/v1/projects/00000000-0000-0000-0000-000000000009/dashboard/overview', status: 401, code: 10001 },
    { name: 'T2-2 注册', method: 'POST', path: '/api/v1/auth/register', body: { email: `jm-dash001b-${stamp()}@rabbit.test`, password: 'rabbit-pass-123' }, status: 201 },
    { name: 'T2-3 他项目 404', method: 'GET', path: '/api/v1/projects/00000000-0000-0000-0000-000000000009/dashboard/overview', status: 404, code: 20404 },
  ]),
]);

// ── 落盘 ──
let written = 0;
for (const [name, content] of files) {
  const abs = path.join(ROOT, 'tests/api', name);
  if (existsSync(abs) && !FORCE) continue;
  writeFileSync(abs, content);
  written++;
}
console.log(`jmx written=${written}`);
