/** Sprint 3 域客户端（API-006~010、EXEC-003、RPT-003）。路径唯一出口，前端禁止手写（门禁 4）。 */
import { get, post, put, del, downloadRaw, request } from "./client";
import { qs } from "./s1";
import type { PageOf } from "./s1";
import type { ScenarioStepNode, ScenarioTreeView } from "@rabbit/shared/execution";

// ── API-006 场景 ──

export interface ScenarioRow {
  id: string;
  num: number;
  name: string;
  level: string;
  status: string;
  tags: string[];
  moduleId: string;
  version: number;
  stepCount: number;
  lastRun: { status: string; finishedAt: string | null } | null;
  deletedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioParamsSave {
  constants: { name: string; value: string; description?: string }[];
  lists: { name: string; values: string[] }[];
  csv: {
    source: "file" | "inline";
    fileId?: string;
    inlineText?: string;
    delimiter: "," | ";" | "\t";
    hasHeader: boolean;
  };
}
export interface ScenarioConfigSave {
  params: ScenarioParamsSave;
  prePost: { pre: unknown[]; post: unknown[] };
  asserts: unknown[];
  settings: { cookieMode: "off" | "keep"; thinkTimeMs: number; onFailure: "continue" | "abort" };
}

export interface ScenarioDetail extends ScenarioRow {
  config: ScenarioConfigSave;
  steps: ScenarioStepNode[];
}

export const scenarioApi = {
  list: (
    projectId: string,
    q: {
      moduleId?: string;
      includeChildren?: boolean;
      keyword?: string;
      level?: string;
      status?: string;
      tag?: string;
      recycle?: boolean;
      page?: number;
      pageSize?: number;
    },
  ) => get<PageOf<ScenarioRow>>(`/api/v1/projects/${projectId}/scenarios${qs(q)}`),
  detail: (projectId: string, id: string) =>
    get<ScenarioDetail>(`/api/v1/projects/${projectId}/scenarios/${id}`),
  create: (
    projectId: string,
    body: {
      name: string;
      moduleId: string;
      level?: string;
      status?: string;
      tags?: string[];
      config?: Partial<ScenarioConfigSave>;
    },
  ) => post<{ id: string; num: number }>(`/api/v1/projects/${projectId}/scenarios`, body),
  update: (
    projectId: string,
    id: string,
    body: {
      name: string;
      moduleId: string;
      level: string;
      status: string;
      tags: string[];
      version: number;
      config: ScenarioConfigSave;
    },
  ) => put<{ id: string; version: number }>(`/api/v1/projects/${projectId}/scenarios/${id}`, body),
  remove: (projectId: string, id: string) =>
    del<{ id: string }>(`/api/v1/projects/${projectId}/scenarios/${id}`),
  restore: (projectId: string, id: string) =>
    post<{ id: string }>(`/api/v1/projects/${projectId}/scenarios/${id}/restore`, {}),
  purge: (projectId: string, id: string) =>
    del<{ id: string }>(`/api/v1/projects/${projectId}/scenarios/${id}/purge`),
  copy: (projectId: string, id: string) =>
    post<{ id: string; num: number }>(`/api/v1/projects/${projectId}/scenarios/${id}/copy`, {}),
  steps: (projectId: string, id: string) =>
    get<{ steps: ScenarioStepNode[]; version: number }>(
      `/api/v1/projects/${projectId}/scenarios/${id}/steps`,
    ),
  saveSteps: (
    projectId: string,
    id: string,
    body: { version: number; steps: ScenarioStepNode[] },
  ) =>
    put<{ id: string; version: number; stepCount: number }>(
      `/api/v1/projects/${projectId}/scenarios/${id}/steps`,
      body,
    ),
  execute: (projectId: string, id: string, body: { envId?: string; poolId?: string }) =>
    post<{ taskId: string; warnings?: string[] }>(
      `/api/v1/projects/${projectId}/scenarios/${id}/execute`,
      body,
    ),
  executeStep: (projectId: string, id: string, stepId: string, body: { envId?: string }) =>
    post<{ taskId: string }>(
      `/api/v1/projects/${projectId}/scenarios/${id}/steps/${stepId}/execute`,
      body,
    ),
  history: (projectId: string, id: string) =>
    get<
      {
        itemId: string;
        taskId: string;
        taskStatus: string;
        status: string;
        startedAt: string | null;
        finishedAt: string | null;
      }[]
    >(`/api/v1/projects/${projectId}/scenarios/${id}/history`),
  changes: (projectId: string, id: string) =>
    get<{
      items: { seq: number; action: string; user: string; diff: unknown; createdAt: string }[];
    }>(`/api/v1/projects/${projectId}/scenarios/${id}/changes`),
  // API-008 批量
  executeBatch: (
    projectId: string,
    body: {
      scenarioIds: string[];
      envId?: string;
      envGroupId?: string;
      poolId?: string;
      stopOnFail?: boolean;
      mode?: "serial" | "parallel";
    },
  ) =>
    post<
      | { taskId: string; warnings?: string[] }
      | { tasks: { taskId: string; envId: string; envName: string }[]; warnings?: string[] }
    >(`/api/v1/projects/${projectId}/scenarios/execute`, body),
  batchDelete: (projectId: string, ids: string[]) =>
    post<{ count: number }>(`/api/v1/projects/${projectId}/scenarios/batch-delete`, { ids }),
  batchMove: (projectId: string, ids: string[], moduleId: string) =>
    post<{ count: number }>(`/api/v1/projects/${projectId}/scenarios/batch-move`, {
      ids,
      moduleId,
    }),
  batchCopy: (projectId: string, ids: string[]) =>
    post<{ count: number; list: { id: string; num: number }[] }>(
      `/api/v1/projects/${projectId}/scenarios/batch-copy`,
      { ids },
    ),
  // API-009 导入导出（export 端点返回 attachment 文件流，非信封——走 downloadRaw）
  exportJson: (projectId: string, ids: string[], mode: "ref" | "flatten") =>
    downloadRaw(`/api/v1/projects/${projectId}/scenarios/export`, { ids, mode }),
  importPreview: (projectId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    // FormData 必须直接走 request（经 post 会被 JSON.stringify，服务端 formData() 解析失败——S2 upload 同款教训）
    return request<{
      format: string;
      scenarioCount: number;
      stepCount: number;
      warnings: string[];
      firstSteps: { name: string; stepType: string }[];
    }>(`/api/v1/projects/${projectId}/scenarios/import/preview`, { method: "POST", body: form });
  },
  import: (projectId: string, file: File, moduleId?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (moduleId) form.append("moduleId", moduleId);
    return request<{
      count: number;
      list: { id: string; num: number; name: string }[];
      warnings: string[];
    }>(`/api/v1/projects/${projectId}/scenarios/import`, { method: "POST", body: form });
  },
};

// ── API-010 误报规则 ──

export interface FalseAlarmRuleRow {
  id: string;
  name: string;
  matcher: {
    status?: number;
    bodyContains?: string;
    headerContains?: string;
    responseTimeGt?: number;
  };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export const falseAlarmApi = {
  list: (projectId: string) =>
    get<{ total: number; list: FalseAlarmRuleRow[] }>(
      `/api/v1/projects/${projectId}/false-alarm-rules`,
    ),
  create: (
    projectId: string,
    body: {
      name: string;
      matcher: FalseAlarmRuleRow["matcher"];
      enabled?: boolean;
      description?: string;
    },
  ) => post<{ id: string }>(`/api/v1/projects/${projectId}/false-alarm-rules`, body),
  update: (
    projectId: string,
    id: string,
    body: {
      name: string;
      matcher: FalseAlarmRuleRow["matcher"];
      enabled?: boolean;
      description?: string;
    },
  ) => put<{ id: string }>(`/api/v1/projects/${projectId}/false-alarm-rules/${id}`, body),
  remove: (projectId: string, id: string) =>
    del<{ id: string }>(`/api/v1/projects/${projectId}/false-alarm-rules/${id}`),
};

// ── API-008 定时任务 ──

export interface ScenarioScheduleRow {
  id: string;
  name: string;
  cron: string;
  scenarioIds: string[];
  envId?: string;
  enabled: boolean;
  notify: boolean;
  lastRunAt?: string;
}

export const scheduleApi = {
  list: (projectId: string) =>
    get<{ total: number; list: ScenarioScheduleRow[] }>(
      `/api/v1/projects/${projectId}/scenario-schedules`,
    ),
  create: (
    projectId: string,
    body: {
      name: string;
      cron: string;
      scenarioIds: string[];
      envId?: string;
      enabled?: boolean;
      notify?: boolean;
    },
  ) => post<{ id: string }>(`/api/v1/projects/${projectId}/scenario-schedules`, body),
  update: (
    projectId: string,
    id: string,
    body: {
      name: string;
      cron: string;
      scenarioIds: string[];
      envId?: string;
      enabled?: boolean;
      notify?: boolean;
    },
  ) => put<{ id: string }>(`/api/v1/projects/${projectId}/scenario-schedules/${id}`, body),
  remove: (projectId: string, id: string) =>
    del<{ id: string }>(`/api/v1/projects/${projectId}/scenario-schedules/${id}`),
  toggle: (projectId: string, id: string, enabled: boolean) =>
    post<{ id: string; enabled: boolean }>(
      `/api/v1/projects/${projectId}/scenario-schedules/${id}/toggle`,
      { enabled },
    ),
  run: (projectId: string, id: string) =>
    post<{ taskId?: string; skipped?: string }>(
      `/api/v1/projects/${projectId}/scenario-schedules/${id}/run`,
      {},
    ),
};

// ── RPT-003 场景报告 ──

export const scenarioTreeApi = {
  get: (projectId: string, taskId: string, itemId: string) =>
    get<ScenarioTreeView>(
      `/api/v1/projects/${projectId}/reports/${taskId}/items/${itemId}/scenario-tree`,
    ),
};
