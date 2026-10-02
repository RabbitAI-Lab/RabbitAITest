/** S14 AGENT-001 域客户端（项目 Agent/技能库/运行/调试台）。路径唯一出口（门禁 4）。 */
import { get, put, del, post } from "./client";
import type {
  AgentCreateInput,
  AgentRunQuery,
  AgentSkillCreateInput,
  AgentSkillUpdateInput,
  AgentSkillView,
  AgentUpdateInput,
  AgentView,
} from "@rabbit/shared";

export type { AgentView, AgentSkillView } from "@rabbit/shared";

export interface AgentKeyView {
  apiKey: string;
  prefix: string;
  generatedAt: string;
}

export interface AgentRunView {
  id: string;
  agentId: string;
  agentName: string;
  source: "UI" | "A2A";
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED" | "REJECTED";
  promptTokens: number;
  completionTokens: number;
  durationMs: number | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface AgentRunMessageView {
  seq: number;
  role: "user" | "assistant" | "tool";
  name: string | null;
  content: unknown;
  createdAt: string;
}

export interface AgentRunDetailView {
  run: AgentRunView & { input: unknown; output: { text?: string } | null };
  messages: AgentRunMessageView[];
}

export const agentApi = {
  list: (projectId: string) =>
    get<{ total: number; items: AgentView[] }>(`/api/v1/projects/${projectId}/agents`),
  create: (projectId: string, body: AgentCreateInput) =>
    post<AgentView>(`/api/v1/projects/${projectId}/agents`, body),
  get: (projectId: string, agentId: string) =>
    get<AgentView>(`/api/v1/projects/${projectId}/agents/${agentId}`),
  update: (projectId: string, agentId: string, body: AgentUpdateInput) =>
    put<AgentView>(`/api/v1/projects/${projectId}/agents/${agentId}`, body),
  remove: (projectId: string, agentId: string) =>
    del<{ deleted: boolean }>(`/api/v1/projects/${projectId}/agents/${agentId}`),
  run: (projectId: string, agentId: string, body: { message: string }) =>
    post<{ runId: string }>(`/api/v1/projects/${projectId}/agents/${agentId}/run`, body),
  runs: (projectId: string, agentId: string, q: AgentRunQuery = { page: 1, pageSize: 20 }) =>
    get<{ total: number; items: AgentRunView[] }>(
      `/api/v1/projects/${projectId}/agents/${agentId}/runs?page=${q.page}&pageSize=${q.pageSize}` +
        (q.status ? `&status=${q.status}` : "") +
        (q.source ? `&source=${q.source}` : ""),
    ),
  runDetail: (projectId: string, runId: string) =>
    get<AgentRunDetailView>(`/api/v1/projects/${projectId}/agent-runs/${runId}`),
  cancelRun: (projectId: string, runId: string) =>
    post<{ canceled: boolean }>(`/api/v1/projects/${projectId}/agent-runs/${runId}/cancel`, {}),
  rotateKey: (projectId: string, agentId: string) =>
    post<AgentKeyView>(`/api/v1/projects/${projectId}/agents/${agentId}/a2a-key`, {}),
  revokeKey: (projectId: string, agentId: string) =>
    del<{ revoked: boolean }>(`/api/v1/projects/${projectId}/agents/${agentId}/a2a-key`),
};

export const agentSkillApi = {
  list: (projectId: string) =>
    get<{ total: number; items: AgentSkillView[] }>(`/api/v1/projects/${projectId}/agent-skills`),
  create: (projectId: string, body: AgentSkillCreateInput) =>
    post<AgentSkillView>(`/api/v1/projects/${projectId}/agent-skills`, body),
  update: (projectId: string, skillId: string, body: AgentSkillUpdateInput) =>
    put<AgentSkillView>(`/api/v1/projects/${projectId}/agent-skills/${skillId}`, body),
  remove: (projectId: string, skillId: string) =>
    del<{ deleted: boolean }>(`/api/v1/projects/${projectId}/agent-skills/${skillId}`),
};

/** 调试台 SSE（EventSource 直连，不走 client 封装） */
export function agentRunStreamUrl(runId: string): string {
  return `/api/v1/stream/agent-run/${runId}`;
}
