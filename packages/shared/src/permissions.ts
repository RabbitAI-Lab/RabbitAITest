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
const PROJECT_ENV = ["PROJECT_ENV:READ", "PROJECT_ENV:UPDATE"] as const;
const PROJECT_FILE = ["PROJECT_FILE:READ", "PROJECT_FILE:UPDATE"] as const;
const PROJECT_SCRIPT = ["PROJECT_SCRIPT:UPDATE"] as const;
const PROJECT_REPORT = [
  "PROJECT_REPORT:READ",
  "PROJECT_REPORT:SHARE",
  "PROJECT_REPORT:EXPORT",
] as const;

export const PERMISSION_POINTS = [
  ...SYSTEM_USER,
  ...SYSTEM_GROUP,
  ...SYSTEM_PARAM,
  ...SYSTEM_POOL,
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
  ...PROJECT_REPORT,
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
    ...PROJECT_GROUP,
    "PROJECT_TEMPLATE:READ",
    "PROJECT_CASE:READ",
    "PROJECT_CASE_REVIEW:READ",
    "PROJECT_PLAN:READ",
    "PROJECT_BUG:READ",
    "PROJECT_REPORT:READ",
  ],
  ORG_MEMBER: ["ORG_PROJECT:READ"],
  PROJECT_ADMIN: [
    ...PROJECT_GROUP,
    ...PROJECT_MEMBER,
    ...PROJECT_TEMPLATE,
    ...PROJECT_CASE,
    ...PROJECT_CASE_REVIEW,
    ...PROJECT_PLAN,
    ...PROJECT_BUG,
    "PROJECT_API:READ",
    "PROJECT_SCENARIO:READ",
    "PROJECT_ENV:READ",
    "PROJECT_FILE:READ",
    ...PROJECT_REPORT,
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
