/** Sprint 7 域客户端（AI-001~005）。路径唯一出口，前端禁止手写（门禁 4）。 */
import { get, post, put, del } from "./client";

// ── AI-001 模型网关（系统级） ──

export interface AiModelRow {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
  apiKeyConfigured: boolean;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiModelSave {
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  enabled: boolean;
}

export const listAiModels = () =>
  get<{ total: number; list: AiModelRow[] }>("/api/v1/system/ai-models");
export const createAiModel = (data: AiModelSave & { apiKey: string }) =>
  post<{ id: string }>("/api/v1/system/ai-models", data);
export const updateAiModel = (id: string, data: AiModelSave) =>
  put<{ id: string }>(`/api/v1/system/ai-models/${id}`, data);
export const deleteAiModel = (id: string) => del<{ id: string }>(`/api/v1/system/ai-models/${id}`);
export const testAiModel = (id: string) =>
  post<{ ok: true; latencyMs: number; echo: string }>(`/api/v1/system/ai-models/${id}/test`);
export const setDefaultAiModel = (id: string) =>
  put<{ id: string }>(`/api/v1/system/ai-models/${id}/default`, {});

/** 登录可见的启用模型下拉（AI-004） */
export interface AiModelOption {
  id: string;
  name: string;
  provider: string;
  model: string;
  isDefault: boolean;
}
export const listEnabledAiModels = () =>
  get<{ total: number; list: AiModelOption[] }>("/api/v1/ai/models");

// ── AI-002/003 生成（项目级；导入走既有 CASE-001/API-003 客户端） ──

export interface AiCaseDraft {
  name: string;
  prerequisite?: string;
  steps: { desc: string; expect?: string }[];
  level: "critical" | "high" | "medium" | "low";
  tags: string[];
}

export interface AiApiCaseDraft {
  name: string;
  request: {
    headers?: { key: string; value: string }[];
    query?: { key: string; value: string }[];
    bodyJson?: string;
  };
  assertions: {
    source: "status" | "body" | "headers";
    expression: string;
    operator: string;
    expected: string;
  }[];
}

export interface AiGenResult<T> {
  drafts: T[];
  skipped: { index: number; reason: string }[];
}

export const aiGenerateCases = (
  projectId: string,
  data: {
    requirement: string;
    moduleId?: string;
    templateId?: string;
    modelId?: string;
    designMethod?: string;
  },
) => post<AiGenResult<AiCaseDraft>>(`/api/v1/projects/${projectId}/ai/generate/cases`, data);

export const aiGenerateApiCase = (
  projectId: string,
  data: { apiId: string; templateId?: string; modelId?: string; designMethod?: string },
) => post<AiGenResult<AiApiCaseDraft>>(`/api/v1/projects/${projectId}/ai/generate/api-cases`, data);

export interface AiBatchResult {
  apis: { index: number; method: string; path: string; name: string }[];
  drafts: { apiIndex: number; method: string; path: string; draft: AiApiCaseDraft }[];
  skipped: { index: number; reason: string }[];
}

export const aiGenerateApiCaseBatch = (
  projectId: string,
  data: { openapiDoc: string; modelId?: string; designMethod?: string },
) => post<AiBatchResult>(`/api/v1/projects/${projectId}/ai/generate/api-cases/batch`, data);

export interface AiGenRecordRow {
  id: string;
  modelId: string;
  scene: string;
  generatedCount: number;
  importedCount: number;
  createdAt: string;
}
export const listAiGenRecords = (projectId: string) =>
  get<{ total: number; list: AiGenRecordRow[] }>(`/api/v1/projects/${projectId}/ai/gen-records`);

// ── AI-004 助手会话（个人级） ──

export interface AiConversationRow {
  id: string;
  title: string;
  modelId: string | null;
  createdAt: string;
  updatedAt: string;
}
export const listAiConversations = () =>
  get<{ total: number; list: AiConversationRow[] }>("/api/v1/ai/conversations");
export const createAiConversation = (data?: { title?: string }) =>
  post<{ id: string; title: string }>("/api/v1/ai/conversations", data ?? {});
export const renameAiConversation = (id: string, title: string) =>
  put<{ id: string }>(`/api/v1/ai/conversations/${id}`, { title });
export const deleteAiConversation = (id: string) =>
  del<{ id: string }>(`/api/v1/ai/conversations/${id}`);

export interface AiMessageRow {
  id: string;
  role: string;
  text: string;
  createdAt: string;
}
export const listAiMessages = (id: string) =>
  get<{ total: number; list: AiMessageRow[] }>(`/api/v1/ai/conversations/${id}/messages`);

export type AiSseFrameClient =
  | { type: "delta"; text: string }
  | { type: "done"; messageId: string; conversationId: string; title: string }
  | { type: "error"; code: number; message: string };

/** SSE 流式对话消费（POST 流；AbortController 停止生成）。原生 fetch+常量相对路径——request() 会强制 JSON 解析（stream.ts 同款口径）。 */
export async function streamAiChat(
  input: { conversationId?: string; content: string; modelId?: string },
  onFrame: (frame: AiSseFrameClient) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/v1/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split("\n\n");
    buf = blocks.pop() ?? "";
    for (const block of blocks) {
      const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      try {
        onFrame(JSON.parse(dataLine.slice(5).trim()) as AiSseFrameClient);
      } catch {
        // 忽略无法解析的帧
      }
    }
  }
}

// ── AI-005 提示词模板（项目级） ──

export interface AiPromptRow {
  id: string;
  name: string;
  scene: "case_gen" | "api_gen";
  template: string;
  designMethod: string | null;
  isDefault: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface AiPromptSave {
  name: string;
  scene: "case_gen" | "api_gen";
  template: string;
  designMethod?: string;
  isDefault: boolean;
  enabled: boolean;
}
export const listAiPrompts = (projectId: string) =>
  get<{ total: number; list: AiPromptRow[] }>(`/api/v1/projects/${projectId}/ai/prompt-templates`);
export const createAiPrompt = (projectId: string, data: AiPromptSave) =>
  post<{ id: string }>(`/api/v1/projects/${projectId}/ai/prompt-templates`, data);
export const updateAiPrompt = (projectId: string, id: string, data: AiPromptSave) =>
  put<{ id: string }>(`/api/v1/projects/${projectId}/ai/prompt-templates/${id}`, data);
export const deleteAiPrompt = (projectId: string, id: string) =>
  del<{ id: string }>(`/api/v1/projects/${projectId}/ai/prompt-templates/${id}`);
