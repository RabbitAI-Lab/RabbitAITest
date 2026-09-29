/** Sprint 4 域客户端（PLAN-002~005、CASE-007/008、DASH-002）。路径唯一出口，前端禁止手写（门禁 4）。 */
import { get, post, put, del, downloadRaw } from "./client";
import { qs } from "./s1";
import type { PageOf } from "./s1";
import type { MindmapSave, PointConfig } from "@rabbit/shared";

// ── PLAN-002 测试点 ──

export interface PointCounts {
  functional_case: number;
  api_case: number;
  scenario: number;
}
export interface PointNode {
  id: string;
  parentId: string | null;
  name: string;
  inheritConfig: boolean;
  config: Partial<PointConfig>;
  order: number;
  counts: PointCounts;
  children: PointNode[];
}

export const pointApi = {
  list: (projectId: string, planId: string) =>
    get<{ points: PointNode[]; ungrouped: PointCounts }>(
      `/api/v1/projects/${projectId}/plans/${planId}/points`,
    ),
  create: (
    projectId: string,
    planId: string,
    body: {
      name: string;
      parentId?: string | null;
      inheritConfig?: boolean;
      config?: Partial<PointConfig>;
    },
  ) =>
    post<{ id: string; name: string }>(
      `/api/v1/projects/${projectId}/plans/${planId}/points`,
      body,
    ),
  update: (
    projectId: string,
    planId: string,
    pointId: string,
    body: {
      name?: string;
      parentId?: string | null;
      inheritConfig?: boolean;
      config?: Partial<PointConfig>;
    },
  ) => put<{ id: string }>(`/api/v1/projects/${projectId}/plans/${planId}/points/${pointId}`, body),
  remove: (projectId: string, planId: string, pointId: string) =>
    del<{ ok: boolean }>(`/api/v1/projects/${projectId}/plans/${planId}/points/${pointId}`),
  reorder: (projectId: string, planId: string, orderedIds: string[]) =>
    put<{ ok: boolean }>(`/api/v1/projects/${projectId}/plans/${planId}/points-order`, {
      orderedIds,
    }),
  moveCases: (projectId: string, planId: string, refIds: string[], pointId: string | null) =>
    post<{ affected: number }>(`/api/v1/projects/${projectId}/plans/${planId}/cases/move`, {
      refIds,
      pointId,
    }),
};

// ── PLAN-002 关联扩展（挂点 + 场景）──

export const planCaseApi = {
  add: (
    projectId: string,
    planId: string,
    body: {
      caseIds?: string[];
      apiCaseIds?: string[];
      scenarioIds?: string[];
      pointId?: string | null;
      execUserId?: string;
    },
  ) => post<{ added: number }>(`/api/v1/projects/${projectId}/plans/${planId}/cases`, body),
};

// ── PLAN-003 计划执行 ──

export interface PlanExecuteBody {
  pointId?: string;
  mode?: "serial" | "parallel";
  stopOnFail?: boolean;
  envId?: string | null;
  poolId?: string | null;
}

export const planExecApi = {
  execute: (projectId: string, planId: string, body: PlanExecuteBody) =>
    post<{ taskId: string; itemCount: number; warnings: string[] }>(
      `/api/v1/projects/${projectId}/plans/${planId}/execute`,
      body,
    ),
  runRef: (projectId: string, planId: string, refId: string) =>
    post<{ taskId: string; itemCount: number }>(
      `/api/v1/projects/${projectId}/plans/${planId}/cases/${refId}/run`,
      {},
    ),
  executions: (projectId: string, planId: string, page = 1, pageSize = 20) =>
    get<
      PageOf<{
        taskId: string;
        status: string;
        itemCount: number;
        durationMs: number | null;
        createdAt: string;
        finishedAt: string | null;
        createdBy: string;
      }>
    >(`/api/v1/projects/${projectId}/plans/${planId}/executions${qs({ page, pageSize })}`),
};

// ── PLAN-004 计划分组 ──

export interface PlanGroupMember {
  id: string;
  name: string;
  groupId: string | null;
  caseCount: number;
  executed: number;
  progress: number;
  passRate: number | null;
  thresholdMet: boolean | null;
  status: string;
  archivedAt: string | null;
  createdAt: string;
}
export interface PlanGroupRow {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  aggregate: {
    memberCount: number;
    totalRefs: number;
    executed: number;
    passRate: number | null;
    thresholdMetCount: number;
  };
  members: PlanGroupMember[];
}
export interface PlanGroupReport {
  groupId: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  aggregate: {
    memberCount: number;
    totalRefs: number;
    executed: number;
    passRate: number | null;
    thresholdMetCount: number;
  };
  members: Omit<PlanGroupMember, "groupId">[];
  reportId: string;
  summary: string;
  generatedAt: string;
}

export const planGroupApi = {
  list: (projectId: string, archived = false) =>
    get<{ groups: PlanGroupRow[]; ungrouped: PlanGroupMember[] }>(
      `/api/v1/projects/${projectId}/plan-groups${qs({ archived: archived ? "only" : undefined })}`,
    ),
  create: (projectId: string, body: { name: string; description?: string }) =>
    post<{ id: string; name: string }>(`/api/v1/projects/${projectId}/plan-groups`, body),
  update: (projectId: string, groupId: string, body: { name?: string; description?: string }) =>
    put<{ id: string }>(`/api/v1/projects/${projectId}/plan-groups/${groupId}`, body),
  remove: (projectId: string, groupId: string) =>
    del<{ ok: boolean }>(`/api/v1/projects/${projectId}/plan-groups/${groupId}`),
  archive: (projectId: string, groupId: string) =>
    post<{ id: string; archived: boolean }>(
      `/api/v1/projects/${projectId}/plan-groups/${groupId}/archive`,
      {},
    ),
  unarchive: (projectId: string, groupId: string) =>
    post<{ id: string; archived: boolean }>(
      `/api/v1/projects/${projectId}/plan-groups/${groupId}/unarchive`,
      {},
    ),
  report: (projectId: string, groupId: string) =>
    get<PlanGroupReport>(`/api/v1/projects/${projectId}/plan-groups/${groupId}/report`),
  saveReportSummary: (projectId: string, groupId: string, summary: string) =>
    put<{ reportId: string }>(
      `/api/v1/projects/${projectId}/plan-groups/${groupId}/report/summary`,
      { summary },
    ),
  movePlan: (projectId: string, planId: string, groupId: string | null) =>
    post<{ planId: string; groupId: string | null }>(
      `/api/v1/projects/${projectId}/plans/${planId}/move-group`,
      { groupId },
    ),
  batchArchive: (projectId: string, ids: string[], archived: boolean) =>
    post<{ affected: number; cascadedGroups: number }>(
      `/api/v1/projects/${projectId}/plans/batch-archive`,
      { ids, archived },
    ),
};

// ── PLAN-005 计划报告 ──

export interface PlanReportRow {
  refId: string;
  refType: string;
  name: string;
  executor: string | null;
  status: string;
  actualResult: string;
  lastRunAt: string | null;
  reportTaskId: string | null;
}
export interface PlanReportView {
  reportId: string;
  planId: string;
  planName: string;
  threshold: number;
  overview: {
    total: number;
    executed: number;
    pass: number;
    fail: number;
    blocked: number;
    skipped: number;
    fakeError: number;
    passRate: number | null;
    thresholdMet: boolean | null;
  };
  points: {
    pointId: string | null;
    name: string;
    passRate: number | null;
    rows: PlanReportRow[];
  }[];
  summary: string;
  generatedAt: string;
}

export const planReportApi = {
  view: (projectId: string, planId: string) =>
    get<PlanReportView>(`/api/v1/projects/${projectId}/plans/${planId}/report/view`),
  refresh: (projectId: string, planId: string) =>
    post<PlanReportView>(`/api/v1/projects/${projectId}/plans/${planId}/report/view`, {}),
  draft: (projectId: string, planId: string) =>
    post<{ draft: string }>(`/api/v1/projects/${projectId}/plans/${planId}/report/draft`, {}),
  createShare: (projectId: string, planId: string, expireHours: 1 | 24 | 168 | 720) =>
    post<{ token: string; expireAt: string }>(
      `/api/v1/projects/${projectId}/plans/${planId}/report/shares`,
      { expireHours },
    ),
  listShares: (projectId: string, planId: string) =>
    get<{ items: { token: string; expireAt: string; expired: boolean; createdAt: string }[] }>(
      `/api/v1/projects/${projectId}/plans/${planId}/report/shares`,
    ),
  revokeShare: (projectId: string, planId: string, token: string) =>
    del<{ ok: boolean }>(`/api/v1/projects/${projectId}/plans/${planId}/report/shares/${token}`),
  exportCsv: (projectId: string, planId: string) =>
    downloadRaw(`/api/v1/projects/${projectId}/plans/${planId}/report/export`),
};

export const planShareApi = {
  detail: (token: string) => get<PlanReportView>(`/api/v1/share/plan/${token}`),
};

// ── CASE-007 脑图 ──

export const mindmapApi = {
  save: (projectId: string, body: MindmapSave) =>
    post<{
      idMap: Record<string, string>;
      conflicts: { id: string; reason: string }[];
      saved: Record<string, number>;
    }>(`/api/v1/projects/${projectId}/cases/mindmap-save`, body),
};

// ── DASH-002 关注（四域入口）──

export const followApi = {
  plan: (projectId: string, planId: string, on: boolean) =>
    on
      ? post<{ followed: boolean }>(`/api/v1/projects/${projectId}/plans/${planId}/follow`, {})
      : del<{ followed: boolean }>(`/api/v1/projects/${projectId}/plans/${planId}/follow`),
  scenario: (projectId: string, scenarioId: string, on: boolean) =>
    on
      ? post<{ followed: boolean }>(
          `/api/v1/projects/${projectId}/scenarios/${scenarioId}/follow`,
          {},
        )
      : del<{ followed: boolean }>(`/api/v1/projects/${projectId}/scenarios/${scenarioId}/follow`),
  apiCase: (projectId: string, apiId: string, caseId: string, on: boolean) =>
    on
      ? post<{ followed: boolean }>(
          `/api/v1/projects/${projectId}/apis/${apiId}/cases/${caseId}/follow`,
          {},
        )
      : del<{ followed: boolean }>(
          `/api/v1/projects/${projectId}/apis/${apiId}/cases/${caseId}/follow`,
        ),
  review: (projectId: string, reviewId: string, on: boolean) =>
    on
      ? post<{ followed: boolean }>(`/api/v1/projects/${projectId}/reviews/${reviewId}/follow`, {})
      : del<{ followed: boolean }>(`/api/v1/projects/${projectId}/reviews/${reviewId}/follow`),
};
