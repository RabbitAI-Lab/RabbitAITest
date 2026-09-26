/** Sprint 1 域客户端（SYS-004/005、PROJ-001/002、CASE-002~005、BUG-001、PLAN-001、DASH-001）。 */
import { get, post, put, del, request, downloadRaw } from "./client";

export function qs(query: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ── 通用分页/实体形态 ──
export interface PageOf<T> {
  total: number;
  items: T[];
}

// ── SYS-004 用户与组 ──
export interface UserRow {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  status: string;
  createdAt: string;
}
export const userApi = {
  list: (q: { keyword?: string; page?: number; pageSize?: number }) =>
    get<PageOf<UserRow> & { limit: number }>(`/api/v1/system/users${qs(q)}`),
  create: (body: { email: string; name: string; phone?: string; password?: string }) =>
    post<{ id: string; email: string; name: string; initialPassword: string }>(
      "/api/v1/system/users",
      body,
    ),
  update: (id: string, body: { name?: string; phone?: string | null }) =>
    put<UserRow>(`/api/v1/system/users/${id}`, body),
  remove: (id: string) => del<void>(`/api/v1/system/users/${id}`),
  resetPassword: (id: string) =>
    post<{ newPassword: string }>(`/api/v1/system/users/${id}/reset-password`),
  setStatus: (id: string, status: "ACTIVE" | "DISABLED") =>
    post<{ id: string; status: string }>(`/api/v1/system/users/${id}/status`, { status }),
};

export interface GroupMemberRow {
  userId: string;
  email: string;
  name: string;
}
export interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  scope: string;
  isSystem: boolean;
  permissions: string[];
  disabled: string[];
  memberCount: number;
  createdAt: string;
  members?: GroupMemberRow[];
}
function groupBase(scope: "system" | "org" | "project", scopeId?: string): string {
  if (scope === "system") return "/api/v1/system/groups";
  if (scope === "org") return `/api/v1/orgs/${scopeId}/groups`;
  return `/api/v1/projects/${scopeId}/groups`;
}
export const groupApi = {
  list: (scope: "system" | "org" | "project", scopeId: string, withMembers = false) =>
    get<GroupRow[]>(`${groupBase(scope, scopeId)}${qs({ withMembers: withMembers ? "1" : "" })}`),
  create: (
    scope: "system" | "org" | "project",
    scopeId: string,
    body: { name: string; description?: string; permissions: string[]; disabled?: string[] },
  ) => post<{ id: string; name: string }>(groupBase(scope, scopeId), body),
  update: (
    scope: "system" | "org" | "project",
    scopeId: string,
    id: string,
    body: { name: string; description?: string; permissions: string[]; disabled?: string[] },
  ) => put<{ id: string }>(`${groupBase(scope, scopeId)}/${id}`, body),
  remove: (scope: "system" | "org" | "project", scopeId: string, id: string) =>
    del<void>(`${groupBase(scope, scopeId)}/${id}`),
  addMembers: (
    scope: "system" | "org" | "project",
    scopeId: string,
    id: string,
    userIds: string[],
  ) => post<{ added: number }>(`${groupBase(scope, scopeId)}/${id}/members`, { userIds }),
  removeMember: (
    scope: "system" | "org" | "project",
    scopeId: string,
    id: string,
    userId: string,
  ) => del<void>(`${groupBase(scope, scopeId)}/${id}/members/${userId}`),
  restoreDefault: (scope: "system" | "org" | "project", scopeId: string, id: string) =>
    post<{ id: string }>(`${groupBase(scope, scopeId)}/${id}/restore-default`),
};

export const permApi = {
  resolve: (projectId?: string) =>
    get<{ scoped: string[]; global: string[] }>(
      `/api/v1/personal/permissions${projectId ? `?projectId=${projectId}` : ""}`,
    ),
};

// ── SYS-005 系统参数 ──
export interface SystemParams {
  base: { siteUrl: string; loginBanner: string };
  smtp: { host: string; port: number; user: string; pass: string; ssl: boolean; from: string };
  file: { maxSizeMb: number };
  cleanup: {
    logRetentionDays: number;
    changeLogRetentionDays: number;
    lastRunAt: string | null;
    lastRunCount: number;
  };
}
export const paramApi = {
  get: () => get<SystemParams>("/api/v1/system/params"),
  update: (group: "basic" | "smtp" | "file" | "cleanup", value: Record<string, unknown>) =>
    put<{ ok: boolean }>(`/api/v1/system/params/${group}`, { group, value }),
  testSmtp: (body: SystemParams["smtp"]) =>
    post<{ ok: boolean; message: string }>("/api/v1/system/params/smtp/test", body),
};

// ── PROJ-001 组织项目/成员 ──
export interface OrgProjectRow {
  id: string;
  name: string;
  num: number;
  description: string | null;
  status: string;
  modules: Record<string, boolean>;
  memberCount: number;
  deletedAt: string | null;
  purgeAt: string | null;
  createdAt: string;
}
export interface OrgInfo {
  id: string;
  name: string;
}
export const orgApi = {
  projects: (orgId: string, q?: { deleted?: string; keyword?: string }) =>
    get<PageOf<OrgProjectRow>>(`/api/v1/orgs/${orgId}/projects${qs(q ?? {})}`),
  createProject: (orgId: string, body: { name: string; description?: string }) =>
    post<{ id: string; name: string }>(`/api/v1/orgs/${orgId}/projects`, body),
  members: (orgId: string, q: { keyword?: string; page?: number; pageSize?: number }) =>
    get<
      PageOf<{ id: string; email: string; name: string; phone: string | null; joinedAt: string }>
    >(`/api/v1/orgs/${orgId}/members${qs(q)}`),
};
export interface ProjectInfo {
  id: string;
  name: string;
  num: number;
  description: string | null;
  modules: Record<string, boolean>;
  status: string;
  createdAt: string;
  org: OrgInfo;
}
export const projectInfoApi = {
  get: (projectId: string) => get<ProjectInfo>(`/api/v1/projects/${projectId}/info`),
  update: (
    projectId: string,
    body: { name?: string; description?: string | null; modules?: Record<string, boolean> },
  ) => put<ProjectInfo>(`/api/v1/projects/${projectId}`, body),
  close: (projectId: string) =>
    post<{ id: string; status: string }>(`/api/v1/projects/${projectId}/close`),
  reopen: (projectId: string) =>
    post<{ id: string; status: string }>(`/api/v1/projects/${projectId}/reopen`),
  remove: (projectId: string) => del<void>(`/api/v1/projects/${projectId}`),
  restore: (projectId: string) => post<{ id: string }>(`/api/v1/projects/${projectId}/restore`),
  members: (projectId: string, q: { keyword?: string; page?: number; pageSize?: number }) =>
    get<
      PageOf<{
        id: string;
        email: string;
        name: string;
        role: string;
        joinedAt: string;
        groups: { name: string; isSystem: boolean }[];
      }>
    >(`/api/v1/projects/${projectId}/members${qs(q)}`),
  addMembers: (projectId: string, userIds: string[]) =>
    post<{ added: number }>(`/api/v1/projects/${projectId}/members`, { userIds }),
  removeMember: (projectId: string, userId: string) =>
    del<void>(`/api/v1/projects/${projectId}/members/${userId}`),
};

// ── PROJ-002 字段/模板/工作流 ──
export interface FieldDefRow {
  id: string;
  scene: string;
  name: string;
  key: string;
  type: string;
  required: boolean;
  options: Record<string, unknown>;
  isSystem: boolean;
  enabled: boolean;
  createdAt: string;
}
export interface TemplateRow {
  id: string;
  scene: string;
  name: string;
  isDefault: boolean;
  isSystem: boolean;
  fields: { fieldKey: string; required?: boolean; visibleInList?: boolean }[];
  refCount: number;
  projectMode: boolean;
  createdAt: string;
}
export interface WorkflowDto {
  templateId: string;
  states: { id: string; serial: string; isStart: boolean; isEnd: boolean }[];
  transitions: { from: string; to: string }[];
}
export const fieldDefApi = {
  list: (orgId: string, scene?: string) =>
    get<FieldDefRow[]>(`/api/v1/orgs/${orgId}/field-defs${qs({ scene })}`),
  create: (orgId: string, body: Record<string, unknown>) =>
    post<{ id: string; key: string }>(`/api/v1/orgs/${orgId}/field-defs`, body),
  update: (orgId: string, id: string, body: Record<string, unknown>) =>
    put<{ id: string }>(`/api/v1/orgs/${orgId}/field-defs/${id}`, body),
  remove: (orgId: string, id: string) =>
    del<{ softDisabled: boolean; usedCount: number }>(`/api/v1/orgs/${orgId}/field-defs/${id}`),
};
export const templateApi = {
  list: (orgId: string, projectId: string | null, scene?: string) =>
    get<TemplateRow[]>(
      projectId
        ? `/api/v1/projects/${projectId}/templates${qs({ scene })}`
        : `/api/v1/orgs/${orgId}/templates${qs({ scene })}`,
    ),
  create: (
    orgId: string,
    projectId: string | null,
    body: {
      scene: string;
      name: string;
      fields?: { fieldKey: string; required?: boolean; visibleInList?: boolean }[];
    },
  ) =>
    post<{ id: string }>(
      projectId ? `/api/v1/projects/${projectId}/templates` : `/api/v1/orgs/${orgId}/templates`,
      body,
    ),
  rename: (orgId: string, projectId: string | null, id: string, name: string) =>
    put<{ id: string }>(
      `${projectId ? `/api/v1/projects/${projectId}` : `/api/v1/orgs/${orgId}`}/templates/${id}`,
      { name },
    ),
  remove: (orgId: string, projectId: string | null, id: string) =>
    del<void>(
      `${projectId ? `/api/v1/projects/${projectId}` : `/api/v1/orgs/${orgId}`}/templates/${id}`,
    ),
  updateFields: (
    orgId: string,
    projectId: string | null,
    id: string,
    fields: { fieldKey: string; required?: boolean; visibleInList?: boolean }[],
  ) =>
    put<{ id: string }>(
      `${projectId ? `/api/v1/projects/${projectId}` : `/api/v1/orgs/${orgId}`}/templates/${id}/fields`,
      { fields },
    ),
  setDefault: (orgId: string, projectId: string | null, id: string) =>
    post<{ id: string }>(
      `${projectId ? `/api/v1/projects/${projectId}` : `/api/v1/orgs/${orgId}`}/templates/${id}/default`,
    ),
  copy: (orgId: string, projectId: string | null, id: string) =>
    post<{ id: string }>(
      `${projectId ? `/api/v1/projects/${projectId}` : `/api/v1/orgs/${orgId}`}/templates/${id}/copy`,
    ),
  mode: (projectId: string) =>
    get<{ enabled: boolean }>(`/api/v1/projects/${projectId}/template-mode`),
  enableMode: (projectId: string) =>
    post<{ enabled: boolean }>(`/api/v1/projects/${projectId}/template-mode/enable`),
};
export const workflowApi = {
  get: (projectId: string, templateId?: string) =>
    get<WorkflowDto>(`/api/v1/projects/${projectId}/workflows${qs({ templateId })}`),
  createState: (projectId: string, body: { serial: string; isStart?: boolean; isEnd?: boolean }) =>
    post<{ id: string }>(`/api/v1/projects/${projectId}/workflows/states`, body),
  updateState: (
    projectId: string,
    stateId: string,
    body: { serial?: string; isStart?: boolean; isEnd?: boolean },
  ) => put<{ id: string }>(`/api/v1/projects/${projectId}/workflows/states/${stateId}`, body),
  removeState: (projectId: string, stateId: string) =>
    del<void>(`/api/v1/projects/${projectId}/workflows/states/${stateId}`),
  updateTransitions: (projectId: string, transitions: { fromSerial: string; toSerial: string }[]) =>
    put<{ count: number }>(`/api/v1/projects/${projectId}/workflows/transitions`, { transitions }),
};

// ── CASE-002 模块/列表v2/视图 ──
export interface ModuleNodeDto {
  id: string;
  parentId: string | null;
  name: string;
  isDefault: boolean;
  order: number;
  caseCount: number;
  subtreeCount: number;
  children: ModuleNodeDto[];
}
export const moduleApi = {
  list: (projectId: string, scene: string) =>
    get<{ items: ModuleNodeDto[] }>(`/api/v1/projects/${projectId}/modules${qs({ scene })}`),
  create: (projectId: string, scene: string, body: { name: string; parentId?: string | null }) =>
    post<{ id: string; name: string }>(
      `/api/v1/projects/${projectId}/modules${qs({ scene })}`,
      body,
    ),
  rename: (projectId: string, scene: string, id: string, name: string) =>
    put<{ id: string }>(`/api/v1/projects/${projectId}/modules/${id}${qs({ scene })}`, { name }),
  remove: (projectId: string, scene: string, id: string) =>
    del<{ moved: boolean; deletedNodes: number }>(
      `/api/v1/projects/${projectId}/modules/${id}${qs({ scene })}`,
    ),
  move: (
    projectId: string,
    scene: string,
    id: string,
    body: { parentId: string | null; order: number },
  ) =>
    post<{ id: string }>(`/api/v1/projects/${projectId}/modules/${id}/move${qs({ scene })}`, body),
};
export interface CaseRowV2 {
  id: string;
  num: number;
  name: string;
  precondition: string;
  steps: { desc: string; expect: string }[];
  level: string;
  status: string;
  tags: string[];
  moduleId: string;
  templateId: string | null;
  fields: Record<string, unknown>;
  version: number;
  deletedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
export type CaseQueryV2 = Partial<{
  page: number;
  pageSize: number;
  keyword: string;
  level: string;
  orderBy: "num" | "updatedAt" | "name";
  order: "asc" | "desc";
  recycled: string;
  moduleId: string;
  includeChildren: string;
  tags: string;
  status: string;
  creator: string;
  updatedFrom: string;
  updatedTo: string;
  fields: string;
  viewId: string;
  followedBy: string;
  createdByMe: string;
}>;
export const caseApiV2 = {
  list: (projectId: string, q: CaseQueryV2) =>
    get<PageOf<CaseRowV2>>(`/api/v1/projects/${projectId}/cases${qs(q)}`),
  detail: (projectId: string, caseId: string) =>
    get<CaseRowV2>(`/api/v1/projects/${projectId}/cases/${caseId}`),
  create: (projectId: string, body: Record<string, unknown>) =>
    post<CaseRowV2>(`/api/v1/projects/${projectId}/cases`, body),
  update: (projectId: string, caseId: string, body: Record<string, unknown>) =>
    put<CaseRowV2>(`/api/v1/projects/${projectId}/cases/${caseId}`, body),
  remove: (projectId: string, caseId: string) =>
    del<void>(`/api/v1/projects/${projectId}/cases/${caseId}`),
  restore: (projectId: string, caseId: string) =>
    post<void>(`/api/v1/projects/${projectId}/cases/${caseId}/restore`),
  purge: (projectId: string, caseId: string) =>
    del<void>(`/api/v1/projects/${projectId}/cases/${caseId}?purge=true`),
  copy: (projectId: string, caseId: string) =>
    post<{ id: string; num: number; name: string }>(
      `/api/v1/projects/${projectId}/cases/${caseId}/copy`,
    ),
  follow: (projectId: string, caseId: string, on: boolean) =>
    on
      ? post<{ following: boolean }>(`/api/v1/projects/${projectId}/cases/${caseId}/follow`)
      : del<{ following: boolean }>(`/api/v1/projects/${projectId}/cases/${caseId}/follow`),
  batch: (
    projectId: string,
    action: "move" | "copy" | "delete" | "update",
    body: Record<string, unknown>,
  ) => post<{ affected: number }>(`/api/v1/projects/${projectId}/cases/batch-${action}`, body),
};
export interface CaseViewDto {
  id: string;
  name: string;
  query: Record<string, unknown>;
  columns?: string[];
  isDefault: boolean;
}
export const viewApi = {
  list: (projectId: string) => get<{ views: CaseViewDto[] }>(`/api/v1/projects/${projectId}/views`),
  create: (
    projectId: string,
    body: { name: string; query: Record<string, unknown>; columns?: string[]; isDefault?: boolean },
  ) => post<CaseViewDto>(`/api/v1/projects/${projectId}/views`, body),
  update: (
    projectId: string,
    id: string,
    body: { name: string; query: Record<string, unknown>; columns?: string[]; isDefault?: boolean },
  ) => put<CaseViewDto>(`/api/v1/projects/${projectId}/views/${id}`, body),
  remove: (projectId: string, id: string) => del<void>(`/api/v1/projects/${projectId}/views/${id}`),
};
export const prefApi = {
  get: (key: string, projectId: string) =>
    get<{ value: unknown }>(
      `/api/v1/personal/preferences/${key}${projectId ? `?projectId=${projectId}` : ""}`,
    ),
  put: (key: string, projectId: string, value: unknown) =>
    put<{ value: unknown }>(
      `/api/v1/personal/preferences/${key}${projectId ? `?projectId=${projectId}` : ""}`,
      { value },
    ),
};

// ── CASE-003 详情关联/评论/历史 ──
export interface DependencyDto {
  id: string;
  case: { id: string; num: number; name: string; level: string };
}
export const dependencyApi = {
  list: (projectId: string, caseId: string) =>
    get<{ pre: DependencyDto[]; post: DependencyDto[] }>(
      `/api/v1/projects/${projectId}/cases/${caseId}/dependencies`,
    ),
  create: (projectId: string, caseId: string, preCaseId: string) =>
    post<{ id: string }>(`/api/v1/projects/${projectId}/cases/${caseId}/dependencies`, {
      preCaseId,
      postCaseId: caseId,
    }),
  remove: (projectId: string, caseId: string, id: string) =>
    del<void>(`/api/v1/projects/${projectId}/cases/${caseId}/dependencies/${id}`),
};
export const caseAggApi = {
  reviews: (projectId: string, caseId: string) =>
    get<
      {
        reviewId: string;
        name: string;
        status: string;
        result: string | null;
        reSubmit: boolean;
        startAt: string | null;
        endAt: string | null;
      }[]
    >(`/api/v1/projects/${projectId}/cases/${caseId}/reviews`),
  plans: (projectId: string, caseId: string) =>
    get<
      {
        planId: string;
        name: string;
        planStatus: string;
        archived: boolean;
        myExecStatus: string | null;
      }[]
    >(`/api/v1/projects/${projectId}/cases/${caseId}/plans`),
  bugs: (projectId: string, caseId: string) =>
    get<{ bugId: string; num: number; title: string; status: string }[]>(
      `/api/v1/projects/${projectId}/cases/${caseId}/bugs`,
    ),
  linkBug: (projectId: string, caseId: string, bugId: string) =>
    post<{ ok: boolean }>(`/api/v1/projects/${projectId}/cases/${caseId}/bugs`, { bugId }),
  unlinkBug: (projectId: string, caseId: string, bugId: string) =>
    del<void>(`/api/v1/projects/${projectId}/cases/${caseId}/bugs/${bugId}`),
  changes: (projectId: string, caseId: string) =>
    get<{
      items: {
        id: string;
        seq: number;
        action: string;
        diff: unknown;
        userName: string;
        createdAt: string;
      }[];
    }>(`/api/v1/projects/${projectId}/cases/${caseId}/changes`),
};
export interface CommentDto {
  id: string;
  content: string;
  parentId: string | null;
  userId: string;
  userName: string;
  createdAt: string;
  updatedAt: string;
}
export const commentApi = {
  list: (projectId: string, entity: string) =>
    get<{ items: CommentDto[] }>(
      `/api/v1/projects/${projectId}/comments?entity=${encodeURIComponent(entity)}`,
    ),
  create: (projectId: string, entity: string, content: string, parentId?: string) =>
    post<{ id: string }>(
      `/api/v1/projects/${projectId}/comments?entity=${encodeURIComponent(entity)}`,
      { content, parentId },
    ),
  update: (projectId: string, commentId: string, content: string) =>
    put<{ id: string }>(`/api/v1/projects/${projectId}/comments/${commentId}`, { content }),
  remove: (projectId: string, commentId: string) =>
    del<void>(`/api/v1/projects/${projectId}/comments/${commentId}`),
};

// ── CASE-004 导入导出 ──
export interface ImportReport {
  mode: string;
  total: number;
  created: number;
  overwritten: number;
  skipped: number;
  failed: number;
  errors: { row: number; reason: string }[];
  ignoredColumns: string[];
}
export const caseIoApi = {
  importCases: (projectId: string, file: File, mode: "overwrite" | "skip", moduleId?: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("mode", mode);
    if (moduleId) form.append("moduleId", moduleId);
    return request<ImportReport>(`/api/v1/projects/${projectId}/cases/import`, {
      method: "POST",
      body: form,
    });
  },
  template: (projectId: string) =>
    downloadRaw(`/api/v1/projects/${projectId}/cases/import/template`),
  exportCases: (
    projectId: string,
    body: { format: string; fields: string[]; caseIds?: string[] },
  ) => downloadRaw(`/api/v1/projects/${projectId}/cases/export`, body),
};

// ── CASE-005 评审 ──
export interface ReviewRow {
  id: string;
  name: string;
  reviewMode: string;
  reviewers: string[];
  status: string;
  startAt: string | null;
  endAt: string | null;
  caseCount: number;
  stats: { pass: number; fail: number; suggest: number; pending: number; judged: number };
  passRate: number;
  overdue: boolean;
  createdAt: string;
}
export interface ReviewCaseRow {
  refId: string;
  caseId: string;
  num: number;
  name: string;
  level: string;
  precondition: string;
  steps: { desc: string; expect: string }[];
  result: string | null;
  reSubmit: boolean;
  results: { userId: string; result: string; comment: string; ts: string }[];
}
export interface ReviewDetail {
  id: string;
  name: string;
  reviewMode: "SINGLE" | "MULTI";
  status: string;
  reviewers: string[];
  startAt: string | null;
  endAt: string | null;
  isReviewer: boolean;
  cases: ReviewCaseRow[];
}
export const reviewApi = {
  list: (
    projectId: string,
    q?: { view?: string; keyword?: string; page?: number; pageSize?: number },
  ) => get<PageOf<ReviewRow>>(`/api/v1/projects/${projectId}/reviews${qs(q ?? {})}`),
  detail: (projectId: string, reviewId: string) =>
    get<ReviewDetail>(`/api/v1/projects/${projectId}/reviews/${reviewId}`),
  create: (projectId: string, body: Record<string, unknown>) =>
    post<{ id: string }>(`/api/v1/projects/${projectId}/reviews`, body),
  update: (projectId: string, reviewId: string, body: Record<string, unknown>) =>
    put<{ id: string }>(`/api/v1/projects/${projectId}/reviews/${reviewId}`, body),
  remove: (projectId: string, reviewId: string) =>
    del<void>(`/api/v1/projects/${projectId}/reviews/${reviewId}`),
  close: (projectId: string, reviewId: string) =>
    post<{ id: string; status: string }>(`/api/v1/projects/${projectId}/reviews/${reviewId}/close`),
  copy: (projectId: string, reviewId: string) =>
    post<{ id: string }>(`/api/v1/projects/${projectId}/reviews/${reviewId}/copy`),
  addCases: (projectId: string, reviewId: string, caseIds: string[]) =>
    post<{ added: number; skipped: number }>(
      `/api/v1/projects/${projectId}/reviews/${reviewId}/cases`,
      { caseIds },
    ),
  removeCase: (projectId: string, reviewId: string, caseId: string) =>
    del<void>(`/api/v1/projects/${projectId}/reviews/${reviewId}/cases/${caseId}`),
  judge: (
    projectId: string,
    reviewId: string,
    caseId: string,
    body: { result: string; comment?: string },
  ) =>
    post<{ caseId: string; result: string }>(
      `/api/v1/projects/${projectId}/reviews/${reviewId}/cases/${caseId}/judge`,
      body,
    ),
  batchJudge: (
    projectId: string,
    reviewId: string,
    caseIds: string[],
    result: string,
    comment = "",
  ) =>
    post<{ items: { caseId: string; result: string }[] }>(
      `/api/v1/projects/${projectId}/reviews/${reviewId}/cases/batch-judge`,
      { caseIds, result, comment },
    ),
  setting: (projectId: string) =>
    get<{ reSubmitEnabled: boolean }>(`/api/v1/projects/${projectId}/settings/case-review`),
  setSetting: (projectId: string, enabled: boolean) =>
    put<{ reSubmitEnabled: boolean }>(`/api/v1/projects/${projectId}/settings/case-review`, {
      enabled,
    }),
};

// ── BUG-001 ──
export interface BugRow {
  id: string;
  num: number;
  title: string;
  status: string;
  handleUserId: string | null;
  moduleId: string | null;
  tags: string[];
  fields: Record<string, unknown>;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  templateId: string | null;
}
export interface BugDetail extends BugRow {
  description: string;
  platform: string;
  createdBy: string;
  allowedTransitions: string[];
}
export const bugApi = {
  list: (projectId: string, q: Record<string, unknown>) =>
    get<PageOf<BugRow>>(`/api/v1/projects/${projectId}/bugs${qs(q)}`),
  detail: (projectId: string, bugId: string) =>
    get<BugDetail>(`/api/v1/projects/${projectId}/bugs/${bugId}`),
  create: (projectId: string, body: Record<string, unknown>) =>
    post<{ id: string; num: number; status: string }>(`/api/v1/projects/${projectId}/bugs`, body),
  update: (projectId: string, bugId: string, body: Record<string, unknown>) =>
    put<{ id: string; version: number }>(`/api/v1/projects/${projectId}/bugs/${bugId}`, body),
  remove: (projectId: string, bugId: string, purge = false) =>
    del<void>(`/api/v1/projects/${projectId}/bugs/${bugId}${purge ? "?purge=true" : ""}`),
  restore: (projectId: string, bugId: string) =>
    post<{ ok: boolean }>(`/api/v1/projects/${projectId}/bugs/${bugId}/restore`),
  transition: (projectId: string, bugId: string, toState: string, comment = "") =>
    post<{ id: string; status: string }>(`/api/v1/projects/${projectId}/bugs/${bugId}/transition`, {
      toState,
      comment,
    }),
  follow: (projectId: string, bugId: string, on: boolean) =>
    post<{ following: boolean }>(`/api/v1/projects/${projectId}/bugs/${bugId}/follow`).then(() => ({
      following: on,
    })),
  cases: (projectId: string, bugId: string) =>
    get<{ caseId: string; num: number; name: string; level: string }[]>(
      `/api/v1/projects/${projectId}/bugs/${bugId}/cases`,
    ),
  linkCase: (projectId: string, bugId: string, caseId: string) =>
    post<{ ok: boolean }>(`/api/v1/projects/${projectId}/bugs/${bugId}/cases`, { caseId }),
  unlinkCase: (projectId: string, bugId: string, caseId: string) =>
    del<void>(`/api/v1/projects/${projectId}/bugs/${bugId}/cases/${caseId}`),
  attachments: (projectId: string, bugId: string) =>
    get<{ id: string; name: string; size: number; mime: string | null; createdAt: string }[]>(
      `/api/v1/projects/${projectId}/bugs/${bugId}/attachments`,
    ),
  addAttachment: (projectId: string, bugId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    form.append("entity", `bug:${bugId}`);
    return request<{ id: string; name: string; size: number }>(
      `/api/v1/projects/${projectId}/attachments`,
      { method: "POST", body: form },
    );
  },
  removeAttachment: (projectId: string, attachmentId: string) =>
    del<void>(`/api/v1/projects/${projectId}/attachments/${attachmentId}`),
  changes: (projectId: string, bugId: string) =>
    get<{
      items: {
        id: string;
        seq: number;
        action: string;
        diff: unknown;
        userName: string;
        createdAt: string;
      }[];
    }>(`/api/v1/projects/${projectId}/bugs/${bugId}/changes`),
  downloadUrl: (projectId: string, attachmentId: string) =>
    `/api/v1/projects/${projectId}/attachments/${attachmentId}/download`,
};

// ── PLAN-001 ──
export interface PlanRow {
  id: string;
  name: string;
  description: string | null;
  moduleId: string | null;
  startAt: string | null;
  endAt: string | null;
  tags: string[];
  settings: { allowDuplicate?: boolean; autoUpdateStatus?: boolean; threshold?: number };
  status: string;
  archivedAt: string | null;
  caseCount: number;
  executed: number;
  progress: number;
  passRate: number | null;
  thresholdMet: boolean | null;
  createdAt: string;
}
export interface PlanCaseRow {
  refId: string;
  caseId: string;
  num: number;
  name: string;
  level: string;
  tags: string[];
  steps: { desc: string; expect: string }[];
  execUserId: string | null;
  status: string;
  result: { actualResult?: string; steps?: { status: string; result: string }[]; comment?: string };
  execHistory: { ts: string; userId: string; from: string; to: string }[];
}
export interface PlanDetail extends Omit<PlanRow, "caseCount" | "executed" | "progress"> {
  stats: {
    passRate: number | null;
    executed: number;
    pass: number;
    fail: number;
    blocked: number;
    skipped: number;
    pending: number;
  };
  cases: PlanCaseRow[];
}
export const planApi = {
  list: (
    projectId: string,
    q?: { keyword?: string; archived?: string; page?: number; pageSize?: number },
  ) => get<PageOf<PlanRow>>(`/api/v1/projects/${projectId}/plans${qs(q ?? {})}`),
  detail: (projectId: string, planId: string) =>
    get<PlanDetail>(`/api/v1/projects/${projectId}/plans/${planId}`),
  create: (projectId: string, body: Record<string, unknown>) =>
    post<{ id: string; name: string }>(`/api/v1/projects/${projectId}/plans`, body),
  update: (projectId: string, planId: string, body: Record<string, unknown>) =>
    put<{ id: string }>(`/api/v1/projects/${projectId}/plans/${planId}`, body),
  remove: (projectId: string, planId: string) =>
    del<void>(`/api/v1/projects/${projectId}/plans/${planId}`),
  archive: (projectId: string, planId: string, archived: boolean) =>
    post<{ id: string; archived: boolean }>(
      `/api/v1/projects/${projectId}/plans/${planId}/${archived ? "archive" : "unarchive"}`,
    ),
  addCases: (projectId: string, planId: string, caseIds: string[], execUserId?: string) =>
    post<{ added: number }>(`/api/v1/projects/${projectId}/plans/${planId}/cases`, {
      caseIds,
      execUserId,
    }),
  removeCase: (projectId: string, planId: string, refId: string) =>
    del<void>(`/api/v1/projects/${projectId}/plans/${planId}/cases/${refId}`),
  exec: (projectId: string, planId: string, refId: string, body: Record<string, unknown>) =>
    post<{ refId: string; status: string }>(
      `/api/v1/projects/${projectId}/plans/${planId}/cases/${refId}/exec`,
      body,
    ),
  batchExecutor: (projectId: string, planId: string, refIds: string[], execUserId: string) =>
    post<{ affected: number }>(
      `/api/v1/projects/${projectId}/plans/${planId}/cases/batch-executor`,
      { refIds, execUserId },
    ),
  report: (projectId: string, planId: string) =>
    get<PlanDetail & { reportId: string; summary: string }>(
      `/api/v1/projects/${projectId}/plans/${planId}/report`,
    ),
  saveSummary: (projectId: string, planId: string, summary: string) =>
    put<{ reportId: string }>(`/api/v1/projects/${projectId}/plans/${planId}/report/summary`, {
      summary,
    }),
};

// ── DASH-001 ──
export interface DashboardOverview {
  caseCard: { total: number; newInRange: number };
  reviewCard: { passRate: number | null; underway: number };
  planCard: { top: { planId: string; name: string; progress: number; passRate: number }[] };
  bugCard: { pending: number; newInRange: number };
  range: { from: string; to: string };
}
export interface DashItem {
  id: string;
  kind: string;
  title: string;
  context?: string;
  href: string;
  createdAt?: string;
  updatedAt?: string;
}
export const dashApi = {
  overview: (projectId: string, range: string, from?: string, to?: string) =>
    get<DashboardOverview>(
      `/api/v1/projects/${projectId}/dashboard/overview${qs({ range, from, to })}`,
    ),
  todo: (projectId: string, kind: string, page = 1) =>
    get<PageOf<DashItem>>(`/api/v1/projects/${projectId}/dashboard/todo${qs({ kind, page })}`),
  followed: (projectId: string, page = 1) =>
    get<PageOf<DashItem>>(`/api/v1/projects/${projectId}/dashboard/followed${qs({ page })}`),
  created: (projectId: string, kind: string, page = 1) =>
    get<PageOf<DashItem>>(`/api/v1/projects/${projectId}/dashboard/created${qs({ kind, page })}`),
};

// ── 项目成员（成员选择器数据源，PROJ-001/DASH 复用）──
export const memberApi = {
  projectMembers: (projectId: string, keyword?: string) =>
    get<PageOf<{ id: string; email: string; name: string }>>(
      `/api/v1/projects/${projectId}/members${qs({ keyword, pageSize: 50 })}`,
    ),
};
