import { get, post, put, del } from "./client";
import type {
  LoadTarget,
  LoadPressure,
  LoadThresholds,
  LoadMetricFrame,
  LoadSummary,
  UiCaseMode,
  UiLocatorType,
  UiParam,
  UiStep,
} from "@rabbit/shared";

// ── S11 SYS-009：OAuth Token 通道（Device Flow 授权确认页 + 授权会话管理）──
// 注：oauth/device/code 与 oauth/token 为 RFC 8628 原生形状（CLI 专用，非信封），不经此客户端。

export interface OAuthPendingDevice {
  clientId: string;
  scope: string[];
  ip: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface AuthorizationRow {
  id: string;
  clientId: string;
  deviceName: string | null;
  scope: string[];
  ip: string | null;
  status: string;
  lastUsedAt: string | null;
  accessExpiresAt: string;
  refreshExpiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export const oauthApi = {
  /** 确认页「校验」步：PENDING 待授权请求回显（无效 422 10030） */
  pending: (code: string) =>
    get<OAuthPendingDevice>(`/api/v1/oauth/device/pending?code=${encodeURIComponent(code)}`),
  approve: (userCode: string, approve: boolean) =>
    post<{ approved: boolean }>(`/api/v1/oauth/device/approve`, { userCode, approve }),
};

export const authorizationApi = {
  list: () => get<AuthorizationRow[]>(`/api/v1/personal/authorizations`),
  revoke: (id: string) => del<{ revoked: boolean }>(`/api/v1/personal/authorizations/${id}`),
  revokeAll: () => del<{ revoked: number }>(`/api/v1/personal/authorizations`),
};

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
  create: (
    projectId: string,
    body: { name: string; target: LoadTarget; pressure: LoadPressure; thresholds?: LoadThresholds },
  ) => post<LoadTestRow>(`/api/v1/projects/${projectId}/load-tests`, body),
  detail: (projectId: string, id: string) =>
    get<LoadTestRow>(`/api/v1/projects/${projectId}/load-tests/${id}`),
  update: (
    projectId: string,
    id: string,
    body: Partial<{
      name: string;
      target: LoadTarget;
      pressure: LoadPressure;
      thresholds: LoadThresholds;
    }>,
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

// ── UIT-002 UI 测试（S13 UIT-003：+脚本模式/校验干跑/trace） ──

/** UI 任务详情（帧→步骤/测试视图聚合；S13：+mode/traces——脚本模式行 op=script、message 含错误代码帧）。 */
export interface UiTaskDetail {
  taskId: string;
  type?: string;
  status: string;
  durationMs: number | null;
  createdAt: string;
  items: {
    itemId: string;
    name: string;
    mode: UiCaseMode;
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
    traces: { fileId: string; name: string }[];
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
  /** S13 UIT-003：steps=指令序列（UIT-002）/script=Playwright 脚本直录 */
  mode: UiCaseMode;
  steps: UiStep[];
  script: string;
  params: UiParam[];
  timeoutMs: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  stepCount?: number;
  /** 脚本模式列表摘要（首个 describe/test 标题） */
  summary?: string;
  lastTask?: { taskId: string; status: string } | null;
}

export const uitApi = {
  elements: (projectId: string, query?: { page?: number; pageSize?: number; name?: string }) =>
    get<{ list: UiElementRow[]; total: number }>(
      `/api/v1/projects/${projectId}/ui-elements?page=${query?.page ?? 1}&pageSize=${query?.pageSize ?? 50}${query?.name ? `&name=${encodeURIComponent(query.name)}` : ""}`,
    ),
  createElement: (
    projectId: string,
    body: { name: string; locatorType: UiLocatorType; locator: string; description?: string },
  ) => post<UiElementRow>(`/api/v1/projects/${projectId}/ui-elements`, body),
  updateElement: (
    projectId: string,
    id: string,
    body: Partial<{
      name: string;
      locatorType: UiLocatorType;
      locator: string;
      description: string;
    }>,
  ) => put<UiElementRow>(`/api/v1/projects/${projectId}/ui-elements/${id}`, body),
  removeElement: (projectId: string, id: string) =>
    del<{ id: string }>(`/api/v1/projects/${projectId}/ui-elements/${id}`),
  cases: (projectId: string, query?: { page?: number; pageSize?: number; name?: string }) =>
    get<{ list: UiCaseRow[]; total: number }>(
      `/api/v1/projects/${projectId}/ui-cases?page=${query?.page ?? 1}&pageSize=${query?.pageSize ?? 20}${query?.name ? `&name=${encodeURIComponent(query.name)}` : ""}`,
    ),
  createCase: (
    projectId: string,
    body: {
      name: string;
      mode?: UiCaseMode;
      steps?: UiStep[];
      script?: string;
      params?: UiParam[];
      timeoutMs?: number;
    },
  ) => post<UiCaseRow>(`/api/v1/projects/${projectId}/ui-cases`, body),
  caseDetail: (projectId: string, id: string) =>
    get<UiCaseRow>(`/api/v1/projects/${projectId}/ui-cases/${id}`),
  updateCase: (
    projectId: string,
    id: string,
    body: Partial<{
      name: string;
      mode: UiCaseMode;
      steps: UiStep[];
      script: string;
      params: UiParam[];
      timeoutMs: number;
    }>,
  ) => put<UiCaseRow>(`/api/v1/projects/${projectId}/ui-cases/${id}`, body),
  removeCase: (projectId: string, id: string) =>
    del<{ id: string }>(`/api/v1/projects/${projectId}/ui-cases/${id}`),
  runCase: (projectId: string, id: string) =>
    post<{ taskId: string }>(`/api/v1/projects/${projectId}/ui-cases/${id}/run`, {}),
  runBatch: (projectId: string, caseIds: string[]) =>
    post<{ taskId: string }>(`/api/v1/projects/${projectId}/ui-cases/batch-run`, { caseIds }),
  /** S13 UIT-003：脚本校验干跑（ui_validate 任务；轮询 execTaskDetailApi.uiDetail 取标题清单/错误定位） */
  validateScript: (projectId: string, body: { name?: string; script: string }) =>
    post<{ taskId: string }>(`/api/v1/projects/${projectId}/ui-cases/validate-script`, body),
};
