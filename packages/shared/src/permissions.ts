/**
 * 权限点单一来源（rbac-permission-model.md §3 + SYS-004/PROJ-001/PROJ-002 随规格入库的新点）。
 * 格式：{SCOPE}_{RESOURCE}:{ACTION}，ACTION ∈ READ | CREATE | UPDATE | DELETE。
 * 新增权限点规则：随首份消费它的功能规格评审入库，禁止规格外私用。
 */
const SYSTEM_USER = [
  "SYSTEM_USER:READ",
  "SYSTEM_USER:CREATE",
  "SYSTEM_USER:UPDATE",
  "SYSTEM_USER:DELETE",
] as const;
const SYSTEM_GROUP = [
  "SYSTEM_GROUP:READ",
  "SYSTEM_GROUP:CREATE",
  "SYSTEM_GROUP:UPDATE",
  "SYSTEM_GROUP:DELETE",
] as const;
const SYSTEM_PARAM = ["SYSTEM_PARAM:READ", "SYSTEM_PARAM:UPDATE"] as const;
const SYSTEM_POOL = ["SYSTEM_POOL:READ", "SYSTEM_POOL:UPDATE"] as const;
/** 插件管理（PLUG-001 随规格入库） */
const SYSTEM_PLUGIN = ["SYSTEM_PLUGIN:READ", "SYSTEM_PLUGIN:UPDATE"] as const;
/** 组织级三方平台服务集成（INTG-001/002 随规格入库） */
const ORG_INTEGRATION = ["ORG_INTEGRATION:READ", "ORG_INTEGRATION:UPDATE"] as const;
/** 三级审计日志读（SYS-008 随规格入库） */
const SYSTEM_AUDIT = ["SYSTEM_AUDIT:READ"] as const;
/** 系统指标面（S8 INFRA-004：/system/metrics Prometheus 文本） */
const SYSTEM_METRICS = ["SYSTEM_METRICS:READ"] as const;
const ORG_AUDIT = ["ORG_AUDIT:READ"] as const;
const PROJECT_AUDIT = ["PROJECT_AUDIT:READ"] as const;
const ORG_PROJECT = [
  "ORG_PROJECT:READ",
  "ORG_PROJECT:CREATE",
  "ORG_PROJECT:UPDATE",
  "ORG_PROJECT:DELETE",
] as const;
const ORG_MEMBER = ["ORG_MEMBER:READ", "ORG_MEMBER:UPDATE"] as const;
const ORG_GROUP = [
  "ORG_GROUP:READ",
  "ORG_GROUP:CREATE",
  "ORG_GROUP:UPDATE",
  "ORG_GROUP:DELETE",
] as const;
const ORG_TEMPLATE = ["ORG_TEMPLATE:READ", "ORG_TEMPLATE:UPDATE"] as const;
const PROJECT_GROUP = [
  "PROJECT_GROUP:READ",
  "PROJECT_GROUP:CREATE",
  "PROJECT_GROUP:UPDATE",
  "PROJECT_GROUP:DELETE",
] as const;
const PROJECT_MEMBER = ["PROJECT_MEMBER:READ", "PROJECT_MEMBER:UPDATE"] as const;
const PROJECT_TEMPLATE = ["PROJECT_TEMPLATE:READ", "PROJECT_TEMPLATE:UPDATE"] as const;
const PROJECT_CASE = [
  "PROJECT_CASE:READ",
  "PROJECT_CASE:CREATE",
  "PROJECT_CASE:UPDATE",
  "PROJECT_CASE:DELETE",
] as const;
const PROJECT_CASE_REVIEW = ["PROJECT_CASE_REVIEW:READ", "PROJECT_CASE_REVIEW:UPDATE"] as const;
const PROJECT_PLAN = [
  "PROJECT_PLAN:READ",
  "PROJECT_PLAN:CREATE",
  "PROJECT_PLAN:UPDATE",
  "PROJECT_PLAN:DELETE",
] as const;
const PROJECT_BUG = [
  "PROJECT_BUG:READ",
  "PROJECT_BUG:CREATE",
  "PROJECT_BUG:UPDATE",
  "PROJECT_BUG:DELETE",
] as const;
const PROJECT_API = [
  "PROJECT_API:READ",
  "PROJECT_API:CREATE",
  "PROJECT_API:UPDATE",
  "PROJECT_API:DELETE",
] as const;
const PROJECT_SCENARIO = [
  "PROJECT_SCENARIO:READ",
  "PROJECT_SCENARIO:CREATE",
  "PROJECT_SCENARIO:UPDATE",
  "PROJECT_SCENARIO:DELETE",
] as const;
const PROJECT_ENV = [
  "PROJECT_ENV:READ",
  "PROJECT_ENV:CREATE",
  "PROJECT_ENV:UPDATE",
  "PROJECT_ENV:DELETE",
] as const;
const PROJECT_FILE = [
  "PROJECT_FILE:READ",
  "PROJECT_FILE:CREATE",
  "PROJECT_FILE:UPDATE",
  "PROJECT_FILE:DELETE",
] as const;
/** 公共脚本（S5 PROJ-005 随规格扩为四动作；S0 仅预置 UPDATE） */
const PROJECT_SCRIPT = [
  "PROJECT_SCRIPT:READ",
  "PROJECT_SCRIPT:CREATE",
  "PROJECT_SCRIPT:UPDATE",
  "PROJECT_SCRIPT:DELETE",
] as const;
/** 消息管理：机器人与事件配置（S5 MSG-001 随规格入库） */
const PROJECT_MESSAGE = [
  "PROJECT_MESSAGE:READ",
  "PROJECT_MESSAGE:CREATE",
  "PROJECT_MESSAGE:UPDATE",
  "PROJECT_MESSAGE:DELETE",
] as const;
const PROJECT_REPORT = [
  "PROJECT_REPORT:READ",
  "PROJECT_REPORT:SHARE",
  "PROJECT_REPORT:EXPORT",
] as const;
/** 任务中心与任务操作（API-003/SYS-006 随规格入库） */
const PROJECT_EXEC_TASK = ["PROJECT_EXEC_TASK:READ", "PROJECT_EXEC_TASK:UPDATE"] as const;
/** AI 能力（S7 AI-001~005 随规格入库：模型管理=系统级；生成/提示词模板=项目级；助手对话个人级不设点） */
const SYSTEM_AI = [
  "SYSTEM_AI:READ",
  "SYSTEM_AI:CREATE",
  "SYSTEM_AI:UPDATE",
  "SYSTEM_AI:DELETE",
] as const;
const PROJECT_AI = [
  "PROJECT_AI:READ",
  "PROJECT_AI:CREATE",
  "PROJECT_AI:UPDATE",
  "PROJECT_AI:DELETE",
] as const;

export const PERMISSION_POINTS = [
  ...SYSTEM_USER,
  ...SYSTEM_GROUP,
  ...SYSTEM_PARAM,
  ...SYSTEM_POOL,
  ...SYSTEM_PLUGIN,
  ...ORG_INTEGRATION,
  ...SYSTEM_AUDIT,
  ...SYSTEM_METRICS,
  ...ORG_AUDIT,
  ...PROJECT_AUDIT,
  ...ORG_PROJECT,
  ...ORG_MEMBER,
  ...ORG_GROUP,
  ...ORG_TEMPLATE,
  ...PROJECT_GROUP,
  ...PROJECT_MEMBER,
  ...PROJECT_TEMPLATE,
  ...PROJECT_CASE,
  ...PROJECT_CASE_REVIEW,
  ...PROJECT_PLAN,
  ...PROJECT_BUG,
  ...PROJECT_API,
  ...PROJECT_SCENARIO,
  ...PROJECT_ENV,
  ...PROJECT_FILE,
  ...PROJECT_SCRIPT,
  ...PROJECT_MESSAGE,
  ...PROJECT_REPORT,
  ...PROJECT_EXEC_TASK,
  ...SYSTEM_AI,
  ...PROJECT_AI,
] as const;

export type PermissionPoint = (typeof PERMISSION_POINTS)[number];

const POINT_SET = new Set<string>(PERMISSION_POINTS);

export function isValidPermissionPoint(p: string): p is PermissionPoint {
  return POINT_SET.has(p);
}

/** 系统管理员 = 全量权限点 */
export const ALL_PERMISSIONS: string[] = [...PERMISSION_POINTS];

/** 预置组权限清单（rbac §2；isSystem 组只读不可改） */
export const PRESET_GROUP_PERMISSIONS = {
  SYSTEM_ADMIN: ALL_PERMISSIONS,
  SYSTEM_MEMBER: ["ORG_PROJECT:READ"],
  ORG_ADMIN: [
    ...ORG_PROJECT,
    ...ORG_MEMBER,
    ...ORG_GROUP,
    ...ORG_TEMPLATE,
    ...ORG_INTEGRATION,
    ...ORG_AUDIT,
    ...PROJECT_GROUP,
    "PROJECT_MEMBER:READ",
    "PROJECT_TEMPLATE:READ",
    "PROJECT_CASE:READ",
    "PROJECT_CASE_REVIEW:READ",
    "PROJECT_PLAN:READ",
    "PROJECT_BUG:READ",
    "PROJECT_REPORT:READ",
    "PROJECT_API:READ",
    "PROJECT_SCENARIO:READ",
    "PROJECT_ENV:READ",
    "PROJECT_FILE:READ",
    "PROJECT_SCRIPT:READ",
    "PROJECT_MESSAGE:READ",
    "PROJECT_AI:READ",
    ...PROJECT_EXEC_TASK,
  ],
  ORG_MEMBER: ["ORG_PROJECT:READ"],
  PROJECT_ADMIN: [
    ...PROJECT_GROUP,
    ...PROJECT_MEMBER,
    ...PROJECT_TEMPLATE,
    ...PROJECT_AUDIT,
    ...PROJECT_CASE,
    ...PROJECT_CASE_REVIEW,
    ...PROJECT_PLAN,
    ...PROJECT_BUG,
    ...PROJECT_API,
    ...PROJECT_SCENARIO,
    ...PROJECT_ENV,
    ...PROJECT_FILE,
    ...PROJECT_SCRIPT,
    ...PROJECT_MESSAGE,
    ...PROJECT_REPORT,
    ...PROJECT_EXEC_TASK,
    ...PROJECT_AI,
  ],
  PROJECT_MEMBER: [
    "PROJECT_MEMBER:READ",
    "PROJECT_TEMPLATE:READ",
    "PROJECT_CASE:READ",
    "PROJECT_CASE:CREATE",
    "PROJECT_CASE:UPDATE",
    "PROJECT_CASE_REVIEW:READ",
    "PROJECT_CASE_REVIEW:UPDATE",
    "PROJECT_PLAN:READ",
    "PROJECT_PLAN:UPDATE",
    "PROJECT_BUG:READ",
    "PROJECT_BUG:CREATE",
    "PROJECT_BUG:UPDATE",
    "PROJECT_REPORT:READ",
    "PROJECT_API:READ",
    "PROJECT_API:CREATE",
    "PROJECT_API:UPDATE",
    "PROJECT_ENV:READ",
    "PROJECT_ENV:CREATE",
    "PROJECT_FILE:READ",
    "PROJECT_FILE:CREATE",
    "PROJECT_SCRIPT:READ",
    "PROJECT_SCRIPT:CREATE",
    "PROJECT_MESSAGE:READ",
    "PROJECT_AI:READ",
    ...PROJECT_EXEC_TASK,
  ],
} as const;

/**
 * 权限并集 − 禁用交集（rbac §1：用户所在任一组将该资源置禁用即整体禁用）。
 * groups 为用户在当前作用域下生效的组（permissions/disabled 已是 JSONB 数组）。
 */
export function resolvePermissionSet(
  groups: { permissions: unknown; disabled?: unknown }[],
): Set<string> {
  const granted = new Set<string>();
  const denied = new Set<string>();
  for (const g of groups) {
    for (const p of Array.isArray(g.permissions) ? g.permissions : []) {
      if (typeof p === "string" && POINT_SET.has(p)) granted.add(p);
    }
    for (const d of Array.isArray(g.disabled) ? g.disabled : []) {
      if (typeof d === "string") denied.add(d);
    }
  }
  // deny 按资源前缀整组剔除（disabled 清单存资源名，如 PROJECT_CASE）
  for (const d of denied) {
    for (const p of [...granted]) {
      if (p === d || p.startsWith(`${d}:`)) granted.delete(p);
    }
  }
  return granted;
}
