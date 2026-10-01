/** Sprint 14 域客户端（UIT-004 项目级 Runner + 环境检测）。路径唯一出口（门禁 4）。 */
import { get, post, patch, del } from "./client";
import type { RunnerEnvCheckItem, RunnerStatus } from "@rabbit/shared";

export interface UiRunnerView {
  id: string;
  projectId: string;
  kind: "builtin" | "project";
  name: string;
  version: string;
  status: RunnerStatus;
  isDefault: boolean;
  installSource?: string;
  installLogTail?: string;
  lastCheckAt: string | null;
  check: { items: RunnerEnvCheckItem[]; checkedAt: string; version?: string } | null;
  createdAt: string;
}

export const uiRunnerApi = {
  list: (projectId: string) =>
    get<{ items: UiRunnerView[]; total: number }>(`/api/v1/projects/${projectId}/ui-runners`),
  detail: (projectId: string, runnerId: string) =>
    get<UiRunnerView>(`/api/v1/projects/${projectId}/ui-runners/${runnerId}`),
  /** 安装（202 受理；进度/终态轮询 detail 或 list） */
  install: (projectId: string, version: string) =>
    post<UiRunnerView>(`/api/v1/projects/${projectId}/ui-runners`, { version }),
  /** 触发环境检测（runnerId="builtin" 为内置 runner） */
  check: (projectId: string, runnerId: string) =>
    post<{ accepted: true }>(`/api/v1/projects/${projectId}/ui-runners/${runnerId}/check`, {}),
  setDefault: (projectId: string, runnerId: string) =>
    patch<{ ok: true }>(`/api/v1/projects/${projectId}/ui-runners/${runnerId}/default`, {}),
  remove: (projectId: string, runnerId: string) =>
    del<{ ok: true }>(`/api/v1/projects/${projectId}/ui-runners/${runnerId}`),
};
