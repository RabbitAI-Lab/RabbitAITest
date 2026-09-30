/** Sprint 11 域客户端（LOAD-003 性能测试 / UIT-002 UI 测试）。路径唯一出口（门禁 4）。 */
import { get, post, put, del } from "./client";
import type {
  LoadTarget,
  LoadPressure,
  LoadThresholds,
  LoadMetricFrame,
  LoadSummary,
  UiLocatorType,
  UiStep,
} from "@rabbit/shared";

// ── LOAD-003 性能测试 ──

export interface LoadTestRow {
  id: string;
  projectId: string;
  name: string;
  status: string;
  target: LoadTarget;
  pressure: LoadPressure;
  thresholds: LoadThresholds;
  envId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastTask?: { taskId: string; status: string } | null;
}

export interface LoadTaskRow {
  taskId: string;
  loadTestId: string | null;
  status: string;
  message: string | null;
  durationMs: number | null;
  createdAt: string;
  createdBy: string;
}

export interface LoadReportView {
  reportId: string;
  taskId: string;
  loadTestId: string | null;
  name: string;
  status: string;
  durationMs: number | null;
  createdAt: string;
  summary: LoadSummary | null;
  frames: LoadMetricFrame[];
}

export const loadApi = {
  list: (projectId: string, query?: { page?: number; pageSize?: number; name?: string }) =>
    get<{ list: LoadTestRow[]; total: number }>(
      `/api/v1/projects/${projectId}/load-tests?page=${query?.page ?? 1}&pageSize=${query?.pageSize ?? 20}${query?.name ? `&name=${encodeURIComponent(query.name)}` : ""}`,
    ),
  create: (projectId: string, body: { name: string; target: LoadTarget; pressure: LoadPressure; thresholds?: LoadThresholds }) =>
    post<LoadTestRow>(`/api/v1/projects/${projectId}/load-tests`, body),
  detail: (projectId: string, id: string) =>
    get<LoadTestRow>(`/api/v1/projects/${projectId}/load-tests/${id}`),
  update: (
    projectId: string,
    id: string,
    body: Partial<{ name: string; target: LoadTarget; pressure: LoadPressure; thresholds: LoadThresholds }>,
  ) => put<LoadTestRow>(`/api/v1/projects/${projectId}/load-tests/${id}`, body),
  remove: (projectId: string, id: string) =>
    del<{ id: string }>(`/api/v1/projects/${projectId}/load-tests/${id}`),
  run: (projectId: string, id: string) =>
    post<{ taskId: string }>(`/api/v1/projects/${projectId}/load-tests/${id}/run`, {}),
  tasks: (projectId: string, query?: { page?: number; pageSize?: number; loadTestId?: string }) =>
    get<{ list: LoadTaskRow[]; total: number }>(
      `/api/v1/projects/${projectId}/load-tasks?page=${query?.page ?? 1}&pageSize=${query?.pageSize ?? 20}${query?.loadTestId ? `&loadTestId=${query.loadTestId}` : ""}`,
    ),
  stop: (projectId: string, taskId: string) =>
    post<{ taskId: string }>(`/api/v1/projects/${projectId}/load-tasks/${taskId}/stop`, {}),
  metrics: (projectId: string, taskId: string) =>
    get<{ taskId: string; status: string; frames: LoadMetricFrame[] }>(
      `/api/v1/projects/${projectId}/load-tasks/${taskId}/metrics`,
    ),
  report: (projectId: string, taskId: string) =>
    get<LoadReportView>(`/api/v1/projects/${projectId}/load-tasks/${taskId}/report`),
  /** SSE 实时流地址（页面 EventSource 用；credentials 同源 cookie） */
  streamUrl: (taskId: string) => `/api/v1/stream/load/${taskId}`,
};

// ── UIT-002 UI 测试 ──

/** UI 任务详情（帧→步骤视图聚合）。 */
export interface UiTaskDetail {
  taskId: string;
  status: string;
  durationMs: number | null;
  createdAt: string;
  items: {
    itemId: string;
    name: string;
    status: string;
    steps: {
      seq: number;
      op: string;
      name: string;
      status: string;
      durationMs: number;
      message: string;
      expected?: string;
      actual?: string;
      screenshotFileId?: string;
    }[];
    frames: { type: string; fileId: string; name: string; stepSeq: number }[];
  }[];
}

export const execTaskDetailApi = {
  uiDetail: (projectId: string, taskId: string) =>
    get<UiTaskDetail>(`/api/v1/projects/${projectId}/ui-tasks/${taskId}`),
};

export interface UiElementRow {
  id: string;
  projectId: string;
  name: string;
  locatorType: UiLocatorType;
  locator: string;
  description: string | null;
  moduleId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UiCaseRow {
  id: string;
  projectId: string;
  name: string;
  steps: UiStep[];
  timeoutMs: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  stepCount?: number;
  lastTask?: { taskId: string; status: string } | null;
}

export const uitApi = {
  elements: (projectId: string, query?: { page?: number; pageSize?: number; name?: string }) =>
    get<{ list: UiElementRow[]; total: number }>(
      `/api/v1/projects/${projectId}/ui-elements?page=${query?.page ?? 1}&pageSize=${query?.pageSize ?? 50}${query?.name ? `&name=${encodeURIComponent(query.name)}` : ""}`,
    ),
  createElement: (projectId: string, body: { name: string; locatorType: UiLocatorType; locator: string; description?: string }) =>
    post<UiElementRow>(`/api/v1/projects/${projectId}/ui-elements`, body),
  updateElement: (projectId: string, id: string, body: Partial<{ name: string; locatorType: UiLocatorType; locator: string; description: string }>) =>
    put<UiElementRow>(`/api/v1/projects/${projectId}/ui-elements/${id}`, body),
  removeElement: (projectId: string, id: string) =>
    del<{ id: string }>(`/api/v1/projects/${projectId}/ui-elements/${id}`),
  cases: (projectId: string, query?: { page?: number; pageSize?: number; name?: string }) =>
    get<{ list: UiCaseRow[]; total: number }>(
      `/api/v1/projects/${projectId}/ui-cases?page=${query?.page ?? 1}&pageSize=${query?.pageSize ?? 20}${query?.name ? `&name=${encodeURIComponent(query.name)}` : ""}`,
    ),
  createCase: (projectId: string, body: { name: string; steps: UiStep[]; timeoutMs?: number }) =>
    post<UiCaseRow>(`/api/v1/projects/${projectId}/ui-cases`, body),
  caseDetail: (projectId: string, id: string) =>
    get<UiCaseRow>(`/api/v1/projects/${projectId}/ui-cases/${id}`),
  updateCase: (projectId: string, id: string, body: Partial<{ name: string; steps: UiStep[]; timeoutMs: number }>) =>
    put<UiCaseRow>(`/api/v1/projects/${projectId}/ui-cases/${id}`, body),
  removeCase: (projectId: string, id: string) =>
    del<{ id: string }>(`/api/v1/projects/${projectId}/ui-cases/${id}`),
  runCase: (projectId: string, id: string) =>
    post<{ taskId: string }>(`/api/v1/projects/${projectId}/ui-cases/${id}/run`, {}),
  runBatch: (projectId: string, caseIds: string[]) =>
    post<{ taskId: string }>(`/api/v1/projects/${projectId}/ui-cases/batch-run`, { caseIds }),
};
