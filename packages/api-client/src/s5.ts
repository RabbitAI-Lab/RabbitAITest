/** Sprint 5 域客户端（MSG-001、BUG-002、PROJ-005/006、FILE-001、SYS-007）。路径唯一出口（门禁 4）。 */
import { get, post, put, patch, del } from "./client";

// ── MSG-001 机器人 / 事件配置 / 站内信 ──

export interface RobotRow {
  id: string;
  name: string;
  channel: "inapp" | "email" | "wecom" | "dingtalk" | "feishu";
  webhook: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface RobotUpsertInput {
  name: string;
  channel: RobotRow["channel"];
  webhook?: string;
  enabled: boolean;
}

export const robotApi = {
  list: (projectId: string) => get<{ total: number; items: RobotRow[] }>(`/api/v1/projects/${projectId}/robots`),
  create: (projectId: string, body: RobotUpsertInput) =>
    post<RobotRow>(`/api/v1/projects/${projectId}/robots`, body),
  update: (projectId: string, id: string, body: RobotUpsertInput) =>
    patch<RobotRow>(`/api/v1/projects/${projectId}/robots/${id}`, body),
  remove: (projectId: string, id: string) => del<{ id: string }>(`/api/v1/projects/${projectId}/robots/${id}`),
  test: (projectId: string, id: string) =>
    post<{ delivered: boolean; detail: string }>(`/api/v1/projects/${projectId}/robots/${id}/test`, {}),
};

export interface MessageEventConfig {
  enabled: boolean;
  robotIds: string[];
  receiverUserIds: string[];
}

export type MessageEventsConfig = Record<string, MessageEventConfig>;

export const messageConfigApi = {
  view: (projectId: string) =>
    get<{ config: MessageEventsConfig; robots: { id: string; name: string; channel: string; enabled: boolean }[] }>(
      `/api/v1/projects/${projectId}/message-config`,
    ),
  save: (projectId: string, config: MessageEventsConfig) =>
    put<{ config: MessageEventsConfig }>(`/api/v1/projects/${projectId}/message-config`, config),
};

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  content: string;
  readAt: string | null;
  createdAt: string;
}

export const notificationApi = {
  list: (q: { page?: number; pageSize?: number; unread?: boolean }) => {
    const p = new URLSearchParams();
    if (q.page) p.set("page", String(q.page));
    if (q.pageSize) p.set("pageSize", String(q.pageSize));
    if (q.unread) p.set("unread", "true");
    return get<{ total: number; items: NotificationRow[] }>(`/api/v1/personal/notifications?${p.toString()}`);
  },
  unreadCount: () => get<{ count: number }>("/api/v1/personal/notifications/unread-count"),
  markRead: (id: string) => post<{ id: string }>(`/api/v1/personal/notifications/${id}/read`, {}),
  markAllRead: () => post<{ updated: number }>("/api/v1/personal/notifications/read-all", {}),
};

// ── BUG-002 回收站批量 ──

export const bugRecycleApi = {
  batchRestore: (projectId: string, ids: string[]) =>
    post<{ affected: number }>(`/api/v1/projects/${projectId}/bugs/batch-restore`, { ids }),
  batchPurge: (projectId: string, ids: string[]) =>
    post<{ affected: number }>(`/api/v1/projects/${projectId}/bugs/batch-purge`, { ids }),
};

// ── PROJ-005 公共脚本 ──

export interface PublicScriptParam {
  name: string;
  defaultValue: string;
  required: boolean;
}

export interface PublicScriptRow {
  id: string;
  name: string;
  language: string;
  status: "DRAFT" | "ENABLED";
  tags: string[];
  params: PublicScriptParam[];
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicScriptUpsertInput {
  name: string;
  language: "javascript";
  tags: string[];
  params: PublicScriptParam[];
  content: string;
}

export const publicScriptApi = {
  list: (projectId: string, keyword?: string) =>
    get<{ total: number; items: PublicScriptRow[] }>(
      `/api/v1/projects/${projectId}/public-scripts${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ""}`,
    ),
  create: (projectId: string, body: PublicScriptUpsertInput) =>
    post<PublicScriptRow>(`/api/v1/projects/${projectId}/public-scripts`, body),
  update: (projectId: string, id: string, body: PublicScriptUpsertInput) =>
    patch<PublicScriptRow>(`/api/v1/projects/${projectId}/public-scripts/${id}`, body),
  setStatus: (projectId: string, id: string, status: "DRAFT" | "ENABLED") =>
    patch<PublicScriptRow>(`/api/v1/projects/${projectId}/public-scripts/${id}`, { status }),
  remove: (projectId: string, id: string, force = false) =>
    del<{ id: string }>(`/api/v1/projects/${projectId}/public-scripts/${id}${force ? "?force=true" : ""}`),
  debug: (projectId: string, id: string, body: { vars: Record<string, string>; params: Record<string, string> }) =>
    post<{ logs: string[]; vars: Record<string, string>; durationMs: number }>(
      `/api/v1/projects/${projectId}/public-scripts/${id}/debug`,
      body,
    ),
  references: (projectId: string, id: string) =>
    get<{ references: { type: string; id: string; name: string }[] }>(
      `/api/v1/projects/${projectId}/public-scripts/${id}/references`,
    ),
};

// ── PROJ-006 环境组 / 全局参数 ──

export interface EnvGroupRow {
  id: string;
  name: string;
  environmentIds: string[];
  createdAt?: string;
}

export const envGroupApi = {
  list: (projectId: string) => get<{ total: number; items: EnvGroupRow[] }>(`/api/v1/projects/${projectId}/env-groups`),
  create: (projectId: string, body: { name: string; environmentIds: string[] }) =>
    post<EnvGroupRow>(`/api/v1/projects/${projectId}/env-groups`, body),
  update: (projectId: string, id: string, body: { name: string; environmentIds: string[] }) =>
    patch<EnvGroupRow>(`/api/v1/projects/${projectId}/env-groups/${id}`, body),
  remove: (projectId: string, id: string) => del<{ id: string }>(`/api/v1/projects/${projectId}/env-groups/${id}`),
};

export interface GlobalParamRow {
  key: string;
  value: string;
  description: string;
}

export const globalParamApi = {
  get: (projectId: string) => get<{ params: GlobalParamRow[] }>(`/api/v1/projects/${projectId}/global-params`),
  save: (projectId: string, params: GlobalParamRow[]) =>
    put<{ params: GlobalParamRow[] }>(`/api/v1/projects/${projectId}/global-params`, { params }),
};

// ── FILE-001 存储库 / 文件回收站 ──

export interface FileRepoRow {
  id: string;
  platform: "gitea" | "github" | "gitlab" | "gitee";
  url: string;
  hasToken: boolean;
  createdAt: string;
}

export const fileRepoApi = {
  list: (projectId: string) => get<{ total: number; items: FileRepoRow[] }>(`/api/v1/projects/${projectId}/file-repos`),
  create: (projectId: string, body: { platform: FileRepoRow["platform"]; url: string; token?: string }) =>
    post<FileRepoRow>(`/api/v1/projects/${projectId}/file-repos`, body),
  update: (projectId: string, id: string, body: { platform: FileRepoRow["platform"]; url: string; token?: string }) =>
    patch<FileRepoRow>(`/api/v1/projects/${projectId}/file-repos/${id}`, body),
  remove: (projectId: string, id: string) => del<{ id: string }>(`/api/v1/projects/${projectId}/file-repos/${id}`),
  test: (projectId: string, id: string) =>
    post<{ ok: boolean; message: string }>(`/api/v1/projects/${projectId}/file-repos/${id}/test`, {}),
  pull: (projectId: string, id: string, body: { branch: string; path: string }) =>
    post<{ pulled: number; refreshed: number; skipped: number }>(
      `/api/v1/projects/${projectId}/file-repos/${id}/pull`,
      body,
    ),
};

export const fileRecycleApi = {
  restore: (projectId: string, fileId: string) =>
    post<{ id: string }>(`/api/v1/projects/${projectId}/files/${fileId}/restore`, {}),
  purge: (projectId: string, fileId: string) =>
    del<{ id: string }>(`/api/v1/projects/${projectId}/files/${fileId}?purge=true`),
  sync: (projectId: string, fileId: string) =>
    post<{ id: string; size: number }>(`/api/v1/projects/${projectId}/files/${fileId}/sync`, {}),
};

// ── SYS-007 个人中心 ──

export const personalApi = {
  updateMe: (body: { name: string; phone: string }) =>
    patch<{ email: string; name: string; phone: string }>("/api/v1/personal/me", body),
  changePassword: (body: { oldPassword: string; newPassword: string }) =>
    post<{ ok: boolean }>("/api/v1/personal/me", body),
  localRunner: () => get<{ address: string | null; preferLocal: boolean }>("/api/v1/personal/local-runner"),
  saveLocalRunner: (body: { address?: string | null; preferLocal: boolean }) =>
    put<{ address: string | null; preferLocal: boolean }>("/api/v1/personal/local-runner", body),
  checkLocalRunner: () => post<{ reachable: boolean; detail: string }>("/api/v1/personal/local-runner/check", {}),
  aiModel: () => get<{ modelId: string | null }>("/api/v1/personal/ai-model"),
  saveAiModel: (modelId: string | null) =>
    put<{ modelId: string | null }>("/api/v1/personal/ai-model", { modelId }),
};
