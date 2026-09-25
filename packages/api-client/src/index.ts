import type { AssertSpec, DebugRequest, TaskStatus } from '@rabbit/shared';
import type { CaseCreateInput, CaseDetail, CaseListQuery } from '@rabbit/shared';
import { get, post, put, del } from './client';

export { ApiError } from './client';

export const authApi = {
  register: (body: { email: string; password: string }) =>
    post<{ userId: string; projectId: string }>('/api/v1/auth/register', body),
  login: (body: { email: string; password: string }) =>
    post<{ userId: string; email: string }>('/api/v1/auth/login', body),
  logout: () => post<void>('/api/v1/auth/logout'),
  me: () => get<{ userId: string; email: string; name: string } | null>('/api/v1/personal/me'),
};

export const projectApi = {
  list: () => get<{ id: string; name: string; num: number; role: string }[]>('/api/v1/personal/projects'),
};

export function qs(query: Partial<CaseListQuery>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const caseApi = {
  list: (projectId: string, query: Partial<CaseListQuery>) =>
    get<{ total: number; items: CaseDetail[] }>(`/api/v1/projects/${projectId}/cases${qs(query)}`),
  detail: (projectId: string, caseId: string) =>
    get<CaseDetail>(`/api/v1/projects/${projectId}/cases/${caseId}`),
  create: (projectId: string, body: CaseCreateInput) =>
    post<{ id: string; num: number }>(`/api/v1/projects/${projectId}/cases`, body),
  update: (projectId: string, caseId: string, body: CaseCreateInput & { version: number }) =>
    put<CaseDetail>(`/api/v1/projects/${projectId}/cases/${caseId}`, body),
  remove: (projectId: string, caseId: string) =>
    del<void>(`/api/v1/projects/${projectId}/cases/${caseId}`),
  restore: (projectId: string, caseId: string) =>
    post<void>(`/api/v1/projects/${projectId}/cases/${caseId}/restore`),
  purge: (projectId: string, caseId: string) =>
    del<void>(`/api/v1/projects/${projectId}/cases/${caseId}?purge=true`),
};

export interface DebugHistoryItem {
  id: string;
  status: TaskStatus;
  url: string;
  method: string;
  createdAt: string;
}

export const execApi = {
  createDebugTask: (projectId: string, request: DebugRequest, asserts: AssertSpec[], clientTaskId?: string) =>
    post<{ taskId: string }>(`/api/v1/projects/${projectId}/exec-tasks`, {
      type: 'api_debug', request, asserts, clientTaskId,
    }),
  debugHistory: (projectId: string) =>
    get<{ total: number; items: DebugHistoryItem[] }>(
      `/api/v1/projects/${projectId}/exec-tasks?type=api_debug&pageSize=20`,
    ),
};

export interface ReportDetail {
  taskId: string;
  status: TaskStatus;
  type: string;
  failureKind?: string;
  message?: string;
  durationMs?: number;
  createdAt: string;
  request?: { method: string; url: string; headers: { key: string; value: string }[]; body: string };
  response?: {
    status: number; durationMs: number;
    headers: { key: string; value: string }[];
    bodyText: string; truncated: boolean;
  };
  asserts: { kind: string; path: string; op: string; expected: string; actual: string; passed: boolean }[];
  logs: { ts: number; level: string; message: string }[];
}

export const reportApi = {
  detail: (projectId: string, taskId: string) =>
    get<ReportDetail>(`/api/v1/projects/${projectId}/reports/${taskId}`),
};

export { streamExecFrames } from './stream';
