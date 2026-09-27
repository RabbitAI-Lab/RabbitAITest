/** Sprint 2 域客户端（API-002~005、PROJ-003/004、EXEC-002、SYS-006、RPT-002、CASE-006）。 */
import { get, post, put, del, downloadRaw, request } from "./client";
import { qs } from "./s1";
import type { PageOf } from "./s1";
import type {
  ApiRequestBundle,
  AssertSpec,
  Extractor,
  Processor,
  RequestSpec,
} from "@rabbit/shared";
import type { EnvSnapshot } from "@rabbit/shared/execution";

// ── API-002 接口定义 ──

export interface ApiRow {
  id: string;
  moduleId: string;
  num: number;
  protocol: string;
  method: string;
  path: string;
  name: string;
  status: "DEBUG" | "RELEASED";
  request: ApiRequestBundle;
  response: { status: number; headers: { key: string; value: string }[]; body: string };
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  caseCount?: number;
}
export const apiApi = {
  list: (
    projectId: string,
    q: { moduleId?: string; includeChildren?: boolean; method?: string; name?: string; status?: string; page?: number; pageSize?: number },
  ) => get<PageOf<ApiRow>>(`/api/v1/projects/${projectId}/apis${qs(q)}`),
  detail: (projectId: string, id: string) => get<ApiRow>(`/api/v1/projects/${projectId}/apis/${id}`),
  create: (projectId: string, body: { moduleId: string; name: string; status?: string; request: ApiRequestBundle; response?: ApiRow["response"] }) =>
    post<ApiRow>(`/api/v1/projects/${projectId}/apis`, body),
  update: (
    projectId: string,
    id: string,
    body: Partial<{ moduleId: string; name: string; status: "DEBUG" | "RELEASED"; request: ApiRequestBundle; response: ApiRow["response"] }> & { version: number },
  ) => put<ApiRow>(`/api/v1/projects/${projectId}/apis/${id}`, body),
  remove: (projectId: string, id: string) => del<{ id: string }>(`/api/v1/projects/${projectId}/apis/${id}`),
  debug: (projectId: string, id: string, body: { request: ApiRequestBundle; envId?: string; clientTaskId?: string }) =>
    post<{ taskId: string }>(`/api/v1/projects/${projectId}/apis/${id}/debug`, body),
  changes: (projectId: string, id: string) =>
    get<{ items: { seq: number; action: string; user: string; diff: unknown; createdAt: string }[] }>(
      `/api/v1/projects/${projectId}/apis/${id}/changes`,
    ),
  references: (projectId: string, id: string) =>
    get<{
      cases: { id: string; num: number; name: string; level: string; status: string; planCount: number }[];
      plans: { id: string; name: string; refCount: number }[];
      functionalCases: { id: string; num: number; name: string }[];
    }>(`/api/v1/projects/${projectId}/apis/${id}/references`),
  importApis: (
    projectId: string,
    body: { format: "openapi3" | "postman" | "rabbit"; source: { url?: string; content?: string }; overwrite: boolean; moduleId: string },
  ) =>
    post<{ created: string[]; overwritten: string[]; skipped: string[]; failed: { line: number; message: string }[] }>(
      `/api/v1/projects/${projectId}/apis/import`,
      body,
    ),
  exportApis: (projectId: string, q: { moduleId?: string; ids?: string }) =>
    downloadRaw(`/api/v1/projects/${projectId}/apis/export${qs(q)}`),
  parseCurl: (projectId: string, curl: string) =>
    post<{ name: string; method: string; path: string; request: ApiRequestBundle }>(
      `/api/v1/projects/${projectId}/apis/parse-curl`,
      { curl },
    ),
};

// ── API-003 接口用例 ──

export interface ApiCaseRow {
  id: string;
  apiId: string;
  num: number;
  name: string;
  level: "P0" | "P1" | "P2" | "P3";
  status: "PREPARE" | "UNDERWAY" | "COMPLETED";
  tags: string[];
  request: ApiRequestBundle;
  version: number;
  syncedVersion: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  outOfSync: boolean;
}
export const apiCaseApi = {
  list: (projectId: string, apiId: string, q: { level?: string; status?: string; name?: string; page?: number; pageSize?: number } = {}) =>
    get<PageOf<ApiCaseRow> & { apiVersion: number }>(`/api/v1/projects/${projectId}/apis/${apiId}/cases${qs(q)}`),
  create: (projectId: string, apiId: string, body: { name: string; level?: string; status?: string; tags?: string[]; request: ApiRequestBundle }) =>
    post<ApiCaseRow>(`/api/v1/projects/${projectId}/apis/${apiId}/cases`, body),
  update: (projectId: string, apiId: string, caseId: string, body: { name: string; level: string; status: string; tags: string[]; request: ApiRequestBundle; version: number }) =>
    put<ApiCaseRow>(`/api/v1/projects/${projectId}/apis/${apiId}/cases/${caseId}`, body),
  remove: (projectId: string, apiId: string, caseId: string) =>
    del<{ id: string }>(`/api/v1/projects/${projectId}/apis/${apiId}/cases/${caseId}`),
  batchDelete: (projectId: string, apiId: string, ids: string[]) =>
    post<{ deleted: number }>(`/api/v1/projects/${projectId}/apis/${apiId}/cases/batch-delete`, { ids }),
  sync: (projectId: string, apiId: string, caseId: string) =>
    post<ApiCaseRow & { diffApplied: { section: string; different: boolean; detail: string[] }[] }>(
      `/api/v1/projects/${projectId}/apis/${apiId}/cases/${caseId}/sync`,
      {},
    ),
  history: (projectId: string, apiId: string, caseId: string) =>
    get<{ items: { itemId: string; taskId: string; taskStatus: string; itemStatus: string; durationMs: number | null; createdAt: string }[] }>(
      `/api/v1/projects/${projectId}/apis/${apiId}/cases/${caseId}/history`,
    ),
  execute: (projectId: string, apiId: string, body: { caseIds: string[]; envId?: string; stopOnFail?: boolean }) =>
    post<{ taskId: string }>(`/api/v1/projects/${projectId}/apis/${apiId}/cases/execute`, body),
};

// ── API-005 Mock ──

export interface MockRow {
  id: string;
  apiId: string;
  name: string;
  enabled: boolean;
  followApi: boolean;
  matchers: { headers: { key: string; value: string }[]; query: { key: string; value: string }[]; bodyContains?: string };
  response: { status: number; headers: { key: string; value: string }[]; body: string; delayMs: number };
}
export const mockApi = {
  list: (projectId: string, apiId: string) => get<PageOf<MockRow>>(`/api/v1/projects/${projectId}/apis/${apiId}/mocks`),
  create: (projectId: string, apiId: string, body: Omit<MockRow, "id" | "apiId">) =>
    post<MockRow>(`/api/v1/projects/${projectId}/apis/${apiId}/mocks`, body),
  update: (projectId: string, apiId: string, mockId: string, body: Omit<MockRow, "id" | "apiId">) =>
    put<MockRow>(`/api/v1/projects/${projectId}/apis/${apiId}/mocks/${mockId}`, body),
  remove: (projectId: string, apiId: string, mockId: string) =>
    del<{ id: string }>(`/api/v1/projects/${projectId}/apis/${apiId}/mocks/${mockId}`),
  url: (projectId: string, apiId: string) =>
    get<{ url: string; apiPath: string }>(`/api/v1/projects/${projectId}/apis/${apiId}/mock-url`),
  debugMock: (projectId: string, mockId: string, body: { query?: Record<string, string>; headers?: Record<string, string>; body?: string }) =>
    post<{
      matched: boolean;
      ruleName: string;
      enabled: boolean;
      unmatched: string[];
      response: MockRow["response"] & { body: string };
    }>(`/api/v1/projects/${projectId}/mocks/${mockId}/debug`, body),
};

// ── PROJ-003 环境 ──

export interface EnvironmentRow {
  id: string;
  name: string;
  config: {
    vars: { key: string; value: string; enabled: boolean }[];
    http: { id: string; name: string; protocol: "http" | "https"; hostname: string; port: number; pathPrefix: string; conditions: { moduleId?: string; pathPrefix?: string } }[];
    hosts: { host: string; address: string }[];
    database: { id: string; name: string; driver: "postgresql"; url: string }[];
    pre: Processor[];
    post: Processor[];
    asserts: AssertSpec[];
    extracts: Extractor[];
  };
  createdAt: string;
  updatedAt: string;
}
export const envApi = {
  list: (projectId: string) => get<PageOf<EnvironmentRow>>(`/api/v1/projects/${projectId}/environments`),
  detail: (projectId: string, id: string) => get<EnvironmentRow>(`/api/v1/projects/${projectId}/environments/${id}`),
  create: (projectId: string, body: { name: string; config: EnvironmentRow["config"] }) =>
    post<EnvironmentRow>(`/api/v1/projects/${projectId}/environments`, body),
  update: (projectId: string, id: string, body: Partial<{ name: string; config: EnvironmentRow["config"] }>) =>
    put<EnvironmentRow>(`/api/v1/projects/${projectId}/environments/${id}`, body),
  remove: (projectId: string, id: string) => del<{ id: string }>(`/api/v1/projects/${projectId}/environments/${id}`),
  copy: (projectId: string, id: string) => post<EnvironmentRow>(`/api/v1/projects/${projectId}/environments/${id}/copy`, {}),
  exportEnv: (projectId: string, id: string) => downloadRaw(`/api/v1/projects/${projectId}/environments/${id}/export`),
  importEnvs: (projectId: string, body: { overwrite: boolean; payload: { name: string; config: EnvironmentRow["config"] }[] }) =>
    post<{ imported: number; overwritten: number; skipped: number }>(`/api/v1/projects/${projectId}/environments/import`, body),
  testDatasource: (projectId: string, url: string) =>
    post<{ ok: boolean; message: string }>(`/api/v1/projects/${projectId}/environments/test-datasource`, { url }),
};

// ── PROJ-004 文件 ──

export interface FileRow {
  id: string;
  moduleId: string | null;
  name: string;
  size: number;
  sizeText: string;
  mime?: string;
  isJar: boolean;
  jarEnabled: boolean;
  createdAt: string;
}
export const fileApi = {
  list: (projectId: string, q: { moduleId?: string; includeChildren?: boolean; keyword?: string; page?: number; pageSize?: number } = {}) =>
    get<PageOf<FileRow>>(`/api/v1/projects/${projectId}/files${qs(q)}`),
  upload: (projectId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    // 直接走 request（FormData 原样传递，保留 multipart 边界头）——经 post 会 JSON.stringify 成
    // "[object FormData]" 导致服务端 req.formData() 抛 TypeError 500（PROJ-004 e2e 定位）
    return request<{ id: string; name: string; size: number }>(
      `/api/v1/projects/${projectId}/files`,
      { method: "POST", body: form },
    );
  },
  update: (projectId: string, id: string, body: { name?: string; moduleId?: string; jarEnabled?: boolean }) =>
    put<FileRow>(`/api/v1/projects/${projectId}/files/${id}`, body),
  remove: (projectId: string, id: string) => del<{ id: string }>(`/api/v1/projects/${projectId}/files/${id}`),
  downloadUrl: (projectId: string, id: string) => `/api/v1/projects/${projectId}/files/${id}/download`,
};

// ── EXEC-002 / SYS-006 任务 ──

export interface ExecTaskRow {
  id: string;
  type: "api_debug" | "api_case";
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "STOPPED";
  stuck: boolean;
  total: number;
  passed: number;
  creator: string;
  createdAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  rerunOf: string | null;
}
export const taskApi = {
  listProject: (projectId: string, q: { type?: string; status?: string; creator?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}) =>
    get<PageOf<ExecTaskRow>>(`/api/v1/projects/${projectId}/exec-tasks${qs(q)}`),
  listAll: (q: { type?: string; status?: string; page?: number; pageSize?: number } = {}) =>
    get<PageOf<ExecTaskRow>>(`/api/v1/exec-tasks${qs(q)}`),
  stop: (projectId: string, taskId: string) =>
    post<{ taskId: string }>(`/api/v1/projects/${projectId}/exec-tasks/${taskId}/stop`, {}),
  rerun: (projectId: string, taskId: string) =>
    post<{ taskId: string }>(`/api/v1/projects/${projectId}/exec-tasks/${taskId}/rerun`, {}),
};
export const debugSubmitApi = {
  submit: (
    projectId: string,
    body: {
      type: "api_debug";
      request: RequestSpec;
      asserts?: AssertSpec[];
      pre?: Processor[];
      post?: Processor[];
      extracts?: Extractor[];
      envId?: string;
      clientTaskId?: string;
    },
  ) => post<{ taskId: string }>(`/api/v1/projects/${projectId}/exec-tasks`, body),
};
export interface PoolRow {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
  maxConcurrency: number;
  status: string;
  canDelete: boolean;
  lastBeatAt: string | null;
  nodes: { nodeId: string; version: string; slots: number; busy: number; lastBeatAt: string; state: "ONLINE" | "OFFLINE" | "UNMATCHED" }[];
}
export const poolApi = {
  list: () => get<PageOf<PoolRow>>(`/api/v1/system/pools`),
  detail: (id: string) => get<PoolRow>(`/api/v1/system/pools/${id}`),
  update: (id: string, body: { maxConcurrency: number }) => put<PoolRow>(`/api/v1/system/pools/${id}`, body),
};

// ── RPT-002 报告与分享 ──

export interface ReportRow {
  taskId: string;
  name: string;
  reportType: string;
  taskStatus: string;
  summary: { total?: number; passed?: number; failed?: number } | null;
  creator: string;
  createdAt: string;
}
export interface ReportItemView {
  itemId: string;
  refType: string;
  refId: string;
  status: string;
  durationMs: number | null;
  assertTotal: number;
  assertPassed: number;
  name: string;
}
export interface ReportDetailV2 {
  taskId: string;
  name: string;
  status: string;
  type: string;
  failureKind?: string;
  message?: string;
  durationMs?: number;
  createdAt: string;
  summary?: { total?: number; passed?: number; failed?: number };
  items: ReportItemView[];
  request?: { method: string; url: string; headers: { key: string; value: string }[]; body: string };
  response?: { status: number; durationMs: number; headers: { key: string; value: string }[]; bodyText: string; truncated: boolean };
  asserts: { kind: string; path: string; op: string; expected: string; actual: string; passed: boolean }[];
  logs: { ts: number; level: string; message: string }[];
  shared?: boolean;
  expireAt?: string;
}
export const reportV2Api = {
  list: (projectId: string, q: { reportType?: string; keyword?: string; page?: number; pageSize?: number } = {}) =>
    get<PageOf<ReportRow>>(`/api/v1/projects/${projectId}/reports${qs(q)}`),
  /** 详情（RPT-002 事件聚合视图；api_debug 兼容单请求视图字段） */
  detail: (projectId: string, taskId: string) =>
    get<ReportDetailV2>(`/api/v1/projects/${projectId}/reports/${taskId}`),
  remove: (projectId: string, taskId: string) => del<{ taskId: string }>(`/api/v1/projects/${projectId}/reports/${taskId}`),
  itemFrames: (projectId: string, taskId: string, itemId: string) =>
    get<unknown[]>(`/api/v1/projects/${projectId}/reports/${taskId}/items/${itemId}/frames`),
  shares: (projectId: string, taskId: string) =>
    get<{ items: { token: string; expireAt: string; expired: boolean; createdAt: string }[] }>(
      `/api/v1/projects/${projectId}/reports/${taskId}/shares`,
    ),
  createShare: (projectId: string, taskId: string, expireHours: 1 | 24 | 168 | 720) =>
    post<{ token: string; expireAt: string }>(`/api/v1/projects/${projectId}/reports/${taskId}/shares`, { expireHours }),
  revokeShare: (projectId: string, taskId: string, token: string) =>
    del<{ token: string }>(`/api/v1/projects/${projectId}/reports/${taskId}/shares/${token}`),
  shareDetail: (token: string) => get<ReportDetailV2>(`/api/v1/share/report/${token}`),
};

// ── CASE-006 用例关联接口 ──

export interface CaseApiRefRow {
  id: string;
  refId: string;
  name: string;
  apiName: string;
  method: string;
  path: string;
  level: string;
  status: string;
  deleted: boolean;
}
export const caseApiRefApi = {
  list: (projectId: string, caseId: string) =>
    get<PageOf<CaseApiRefRow>>(`/api/v1/projects/${projectId}/cases/${caseId}/api-refs`),
  add: (projectId: string, caseId: string, refIds: string[]) =>
    post<{ added: number }>(`/api/v1/projects/${projectId}/cases/${caseId}/api-refs`, { refIds }),
  remove: (projectId: string, caseId: string, refId: string) =>
    del<{ refId: string }>(`/api/v1/projects/${projectId}/cases/${caseId}/api-refs${qs({ refId })}`),
};

// ── 环境选择（执行处下拉） ──
export type EnvSnapshotPreview = EnvSnapshot;
