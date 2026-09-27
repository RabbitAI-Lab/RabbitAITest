/** Sprint 6 域客户端（PLUG-001/002、INTG-001/002/003、API-011、SYS-008）。路径唯一出口（门禁 4）。 */
import { get, post, put, del } from "./client";
import type { PageOf } from "./s1";

// ── PLUG-001 插件管理 ──

export interface PluginRow {
  id: string;
  name: string;
  kind: string;
  version: string;
  spiVersion: string;
  orgScope: "ALL" | string[];
  description: string | null;
  enabled: boolean;
  runtimeStatus: "RUNNING" | "STOPPED" | "ERROR";
  runtimeError: string | null;
  updatedAt: string;
}

export const pluginApi = {
  list: () => get<PluginRow[]>(`/api/v1/system/plugins`),
  upload: (file: File, orgScope: "ALL" | string[]) => {
    const form = new FormData();
    form.append("file", file);
    form.append("orgScope", JSON.stringify(orgScope));
    return post<{ id: string; manifest: unknown }>(`/api/v1/system/plugins`, form);
  },
  update: (id: string, body: { enabled?: boolean; orgScope?: "ALL" | string[] }) =>
    put<{ ok: true }>(`/api/v1/system/plugins/${id}`, body),
  remove: (id: string) => del<{ ok: true }>(`/api/v1/system/plugins/${id}`),
};

// ── INTG-001/002 服务集成 ──

export interface IntegrationView {
  platform: string;
  address: string;
  authType: string;
  hasCredential: boolean;
  testStatus: "NONE" | "OK" | "FAILED";
  testMessage: string | null;
  testedAt: string | null;
  updatedAt: string;
}

export interface SyncConfigView {
  platform: string | null;
  projectKey?: string;
  bugTypes?: Array<{ local: string; platform: string }>;
  statusMapping?: Array<{ platform: string; local: string }>;
  mode?: string;
  cron?: string | null;
  enabled: boolean;
  updatedAt?: string;
}

export interface SyncHistoryEntry {
  at: string;
  direction: "push" | "pull";
  ok: boolean;
  detail: string;
  ms: number;
  trigger?: string;
}

export const integrationApi = {
  list: (orgId: string) => get<IntegrationView[]>(`/api/v1/orgs/${orgId}/integrations`),
  save: (orgId: string, body: { platform: string; address: string; authType: string; username?: string; password?: string; token?: string }) =>
    put<{ ok: true }>(`/api/v1/orgs/${orgId}/integrations`, body),
  remove: (orgId: string, platform: string) =>
    del<{ ok: true }>(`/api/v1/orgs/${orgId}/integrations?platform=${encodeURIComponent(platform)}`),
  testConnection: (orgId: string, platform: string) =>
    post<{ account?: string; email?: string }>(`/api/v1/orgs/${orgId}/integrations/test`, { platform }),
  getSyncConfig: (projectId: string) =>
    get<SyncConfigView>(`/api/v1/projects/${projectId}/integration`),
  saveSyncConfig: (
    projectId: string,
    body: {
      platform: string;
      projectKey: string;
      bugTypes: Array<{ local: string; platform: string }>;
      statusMapping: Array<{ platform: string; local: string }>;
      mode: "INCREMENT" | "FULL";
      cron?: string | null;
      enabled: boolean;
    },
  ) => put<{ ok: true }>(`/api/v1/projects/${projectId}/integration`, body),
  pushBug: (projectId: string, bugId: string) =>
    post<{ platformKey: string }>(`/api/v1/projects/${projectId}/bugs/${bugId}/sync`, {}),
  pullBugs: (projectId: string) =>
    post<{ pulled: number; updated: number }>(`/api/v1/projects/${projectId}/integration/pull`, {}),
  syncHistory: (projectId: string) =>
    get<PageOf<SyncHistoryEntry>>(`/api/v1/projects/${projectId}/integration/sync-history`),
};

// ── INTG-003 APIKEY ──

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export const apiKeyApi = {
  list: () => get<ApiKeyRow[]>(`/api/v1/personal/api-keys`),
  create: (name: string) =>
    post<ApiKeyRow & { accessKey: string; secretKey: string }>(`/api/v1/personal/api-keys`, { name }),
  revoke: (id: string) => put<{ ok: true }>(`/api/v1/personal/api-keys/${id}/revoke`, {}),
};

// ── API-011 Swagger 定时同步 ──

export interface SwaggerSyncTask {
  id: string;
  name: string;
  url: string;
  cover: boolean;
  moduleId: string | null;
  cron: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastResult: {
    added: number;
    updated: number;
    skipped: number;
    failed: Array<{ path: string; reason: string }>;
    ok: boolean;
    error?: string;
    ms: number;
  } | null;
}

export const swaggerSyncApi = {
  list: (projectId: string) => get<SwaggerSyncTask[]>(`/api/v1/projects/${projectId}/swagger-sync`),
  create: (projectId: string, body: { name: string; url: string; cover: boolean; moduleId?: string | null; cron: string }) =>
    post<SwaggerSyncTask>(`/api/v1/projects/${projectId}/swagger-sync`, body),
  update: (projectId: string, id: string, body: { name: string; url: string; cover: boolean; moduleId?: string | null; cron: string }) =>
    put<{ ok: true }>(`/api/v1/projects/${projectId}/swagger-sync/${id}`, body),
  remove: (projectId: string, id: string) =>
    del<{ ok: true }>(`/api/v1/projects/${projectId}/swagger-sync/${id}`),
  run: (projectId: string, id: string) =>
    post<SwaggerSyncTask["lastResult"]>(`/api/v1/projects/${projectId}/swagger-sync/${id}/run`, {}),
  history: (projectId: string, id: string) =>
    get<PageOf<NonNullable<SwaggerSyncTask["lastResult"]>>>(`/api/v1/projects/${projectId}/swagger-sync/${id}/history`),
};

// ── SYS-008 审计日志 ──

export interface AuditLogRow {
  id: string;
  userId: string | null;
  userName: string | null;
  scope: string;
  projectId: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  detail: unknown;
  ip: string | null;
  createdAt: string;
}

export const auditApi = {
  system: (q: { action?: string; objectType?: string; keyword?: string; from?: string; to?: string; page?: number; pageSize?: number }) =>
    get<PageOf<AuditLogRow>>(`/api/v1/system/audit-logs?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()}`),
  org: (orgId: string, q: { action?: string; keyword?: string; page?: number }) =>
    get<PageOf<AuditLogRow>>(`/api/v1/orgs/${orgId}/audit-logs?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()}`),
  project: (projectId: string, q: { action?: string; keyword?: string; page?: number }) =>
    get<PageOf<AuditLogRow>>(`/api/v1/projects/${projectId}/audit-logs?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()}`),
};
