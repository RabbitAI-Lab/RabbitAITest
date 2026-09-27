/** AI 域契约与纯函数（S7 AI-001~005）。system prompt 开头固定——apps/mock 供应商按此分支确定性输出（测试契约）。 */
import { z } from "zod";

// ── AI-001 模型网关 ──

export const AI_PROVIDERS = ["deepseek", "openai", "zhipu"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** 供应商默认 baseUrl（前端占位提示；协议统一 OpenAI 兼容 chat/completions） */
export const AI_PROVIDER_DEFAULT_BASEURL: Record<AiProvider, string> = {
  deepseek: "https://api.deepseek.com",
  openai: "https://api.openai.com",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
};

export const AI_MODELS_LIMIT = 10;

export const aiModelSaveSchema = z.object({
  name: z.string().trim().min(1, "名称必填").max(64),
  provider: z.enum(AI_PROVIDERS, { message: "供应商必须为 deepseek/openai/zhipu" }),
  baseUrl: z.string().trim().url("BaseUrl 必须为合法 URL").max(255),
  model: z.string().trim().min(1, "模型名必填").max(128),
  /** 创建必填（aiModelCreateSchema 强化）；编辑留空=不修改（掩码不回填） */
  apiKey: z.string().trim().max(256).optional(),
  enabled: z.boolean().default(true),
});
export type AiModelSaveInput = z.infer<typeof aiModelSaveSchema>;

export const aiModelCreateSchema = aiModelSaveSchema.refine((v) => (v.apiKey ?? "").length > 0, {
  message: "API Key 必填",
  path: ["apiKey"],
});

/** apiKey 永不出现在响应；掩码 sk-****尾4 */
export function maskApiKey(key: string): string {
  if (key.length <= 4) return "sk-****";
  return `sk-****${key.slice(-4)}`;
}

// ── AI-004 会话与对话 ──

export const AI_CHAT_CONTEXT_WINDOW = 20;
export const AI_TITLE_MAX = 20;

export const aiConversationCreateSchema = z.object({
  title: z.string().trim().min(1).max(128).optional(),
  modelId: z.string().trim().max(64).nullish(),
});

export const aiChatSchema = z.object({
  conversationId: z.string().trim().max(64).optional(),
  content: z.string().trim().min(1, "消息内容必填").max(8000),
  modelId: z.string().trim().max(64).optional(),
});
export type AiChatInput = z.infer<typeof aiChatSchema>;

/** 对话 SSE 帧类型（POST /ai/chat 响应 text/event-stream） */
export const AI_SSE = {
  delta: "delta",
  done: "done",
  error: "error",
} as const;
export type AiSseFrame =
  | { type: "delta"; text: string }
  | { type: "done"; messageId: string; conversationId: string; title: string }
  | { type: "error"; code: number; message: string };

// ── AI-005 提示词模板 ──

export const AI_PROMPT_SCENES = ["case_gen", "api_gen"] as const;
export type AiPromptScene = (typeof AI_PROMPT_SCENES)[number];

export const AI_PROMPT_SCENE_LABEL: Record<AiPromptScene, string> = {
  case_gen: "功能用例生成",
  api_gen: "接口用例生成",
};

/** 各 scene 合法占位符（AI-005 §2；未知占位符保存 422 70505） */
export const PROMPT_PLACEHOLDERS: Record<AiPromptScene, string[]> = {
  case_gen: ["requirement", "module", "design_method"],
  api_gen: ["api_spec", "design_method"],
};

const placeholderPattern = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** 扫描模板中全部占位符名（未知名集合；空=合法） */
export function scanPlaceholders(template: string, scene: AiPromptScene): string[] {
  const legal = new Set(PROMPT_PLACEHOLDERS[scene]);
  const unknown = new Set<string>();
  for (const m of template.matchAll(placeholderPattern)) {
    const name = m[1]!;
    if (!legal.has(name)) unknown.add(name);
  }
  return [...unknown];
}

/** 渲染模板：逐占位符替换，缺失变量回退空串（生成侧保证主变量恒有值） */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(placeholderPattern, (_, name: string) => vars[name] ?? "");
}

export const aiPromptSaveSchema = z
  .object({
    name: z.string().trim().min(1, "名称必填").max(64),
    scene: z.enum(AI_PROMPT_SCENES),
    template: z.string().trim().min(1, "模板正文必填").max(8000),
    designMethod: z.string().trim().max(128).optional(),
    isDefault: z.boolean().default(false),
    enabled: z.boolean().default(true),
  })
  .refine((v) => !(v.isDefault && !v.enabled), { message: "停用模板不可设为默认" });
export type AiPromptSaveInput = z.infer<typeof aiPromptSaveSchema>;

/** 内置默认模板（无项目模板时回退；mock 供应商分支哨兵=各 system 常量开头） */
export const BUILTIN_CASE_GEN_TEMPLATE =
  "基于以下需求生成测试用例草稿，设计方法：{{design_method}}。\n需求：{{requirement}}\n目标模块：{{module}}";

export const BUILTIN_API_GEN_TEMPLATE =
  "基于以下接口定义生成 1 条接口用例草稿（正向主路径+关键断言），设计方法：{{design_method}}。\n接口定义：{{api_spec}}";

// ── AI-002/003 生成 ──

export const AI_GEN_MAX_CASES = 10;
export const AI_GEN_BATCH_MAX_APIS = 20;
export const AI_SPEC_SUMMARY_MAX_BYTES = 8 * 1024;

export const aiGenerateCasesSchema = z.object({
  requirement: z.string().trim().min(1, "需求描述必填").max(8000),
  moduleId: z.string().trim().max(64).optional(),
  templateId: z.string().trim().max(64).optional(),
  modelId: z.string().trim().max(64).optional(),
  designMethod: z.string().trim().max(128).optional(),
});
export type AiGenerateCasesInput = z.infer<typeof aiGenerateCasesSchema>;

export const aiGenerateApiCaseSchema = z.object({
  apiId: z.string().trim().min(1, "接口定义必选").max(64),
  templateId: z.string().trim().max(64).optional(),
  modelId: z.string().trim().max(64).optional(),
  designMethod: z.string().trim().max(128).optional(),
});

export const aiGenerateApiCaseBatchSchema = z.object({
  openapiDoc: z.string().trim().min(1, "OpenAPI 文档必填").max(512 * 1024),
  modelId: z.string().trim().max(64).optional(),
  designMethod: z.string().trim().max(128).optional(),
});

/** 功能用例草稿（弱校验：坏条剔除进 skipped） */
export const aiCaseDraftSchema = z.object({
  name: z.string().trim().min(1).max(128),
  prerequisite: z.string().trim().max(2000).optional(),
  steps: z
    .array(
      z.object({
        desc: z.string().trim().min(1).max(2000),
        expect: z.string().trim().max(2000).optional(),
      }),
    )
    .min(1),
  level: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  tags: z.array(z.string().trim().min(1).max(32)).max(8).default([]),
});

/** 接口用例草稿断言算子白名单（映射 S2 六断言子集——AI-003 §2） */
export const AI_ASSERT_OPERATORS = ["eq", "contains", "lt", "exists", "jsonpath-eq"] as const;

export const aiApiCaseDraftSchema = z.object({
  name: z.string().trim().min(1).max(128),
  request: z
    .object({
      headers: z.array(z.object({ key: z.string().trim().min(1).max(64), value: z.string().max(512) })).max(20).optional(),
      query: z.array(z.object({ key: z.string().trim().min(1).max(64), value: z.string().max(512) })).max(20).optional(),
      bodyJson: z.string().max(16 * 1024).optional(),
    })
    .default({}),
  assertions: z
    .array(
      z.object({
        source: z.enum(["status", "body", "headers"]).default("body"),
        expression: z.string().trim().max(256).default(""),
        operator: z.enum(AI_ASSERT_OPERATORS),
        expected: z.string().max(512).default(""),
      }),
    )
    .max(20)
    .default([]),
});

export const AI_CASE_LEVELS = ["critical", "high", "medium", "low"] as const;

// ── system prompt 常量（开头固定，mock 供应商分支依赖） ──

export const CASE_GEN_SYSTEM_PROMPT = `你是 RabbitAITest 的测试用例生成助手。根据用户给出的需求与设计方法，生成 1-${AI_GEN_MAX_CASES} 条中文测试用例。
只输出一个 JSON 数组，不要输出任何其他文字或代码栅栏标记。每个元素结构：
{"name":"用例标题","prerequisite":"前置条件","steps":[{"desc":"步骤描述","expect":"预期结果"}],"level":"critical|high|medium|low","tags":["标签"]}
要求：步骤可执行、预期可断言；level 按风险评级；tags 最多 8 个。`;

export const API_CASE_GEN_SYSTEM_PROMPT = `你是 RabbitAITest 的接口用例生成助手。根据用户给出的接口定义与设计方法，生成 1 条接口用例草稿（正向主路径）。
只输出一个 JSON 数组（恰好 1 个元素），不要输出任何其他文字或代码栅栏标记。元素结构：
{"name":"用例名","request":{"headers":[{"key":"","value":""}],"query":[{"key":"","value":""}],"bodyJson":"JSON 字符串或省略"},"assertions":[{"source":"status|body|headers","expression":"如 $.code","operator":"eq|contains|lt|exists|jsonpath-eq","expected":"期望值"}]}
要求：断言至少 2 条且必须含 status 断言；operator 只能用白名单值。`;

export const ASSISTANT_SYSTEM_PROMPT = `你是 RabbitAITest 测试平台智能助手，熟悉测试管理、接口测试、场景自动化与测试计划领域。
职责：辅助测试人员梳理用例设计思路（等价类/边界值/场景法等）、接口故障排查思路、解读测试文档与平台功能。
边界：不执行任何平台操作、不查询平台数据；不编造不确定的事实；回答保持简洁专业，中文输出。`;

// ── 草稿 → S2 执行契约映射（AI-003 导入；纯函数单测主力） ──

import type { AssertSpec } from "../execution/schemas";

export interface AiDraftAssertion {
  source: "status" | "body" | "headers";
  expression: string;
  /** 白名单见 AI_ASSERT_OPERATORS；宽 string 以兼容 api-client 侧弱类型 */
  operator: string;
  expected: string;
}

/** AI 草稿断言 → S2 assertSchema：lt 强制 response_time；exists 弱化为 contains（登记）；headers→response_header */
export function aiDraftToAsserts(items: AiDraftAssertion[]): AssertSpec[] {
  const out: AssertSpec[] = [];
  for (const a of items) {
    if (a.operator === "lt") {
      out.push({ kind: "response_time", path: "", op: "lt", expected: a.expected || "3000" });
      continue;
    }
    if (a.source === "status") {
      out.push({ kind: "status_code", path: "", op: "eq", expected: a.expected || "200" });
      continue;
    }
    if (a.source === "headers") {
      out.push({ kind: "response_header", path: a.expression || "", op: "contains", expected: a.expected });
      continue;
    }
    // body：expression 为 JSONPath（$.x）；exists 弱化为 contains 空串（结构存在性弱化，登记 AI-003 §6）
    const path = a.expression || "$";
    if (a.operator === "exists") out.push({ kind: "body_jsonpath", path, op: "contains", expected: a.expected || "" });
    else if (a.operator === "jsonpath-eq") out.push({ kind: "body_jsonpath", path, op: "eq", expected: a.expected });
    else if (a.operator === "eq") out.push({ kind: "body_jsonpath", path, op: "eq", expected: a.expected });
    else out.push({ kind: "body_jsonpath", path, op: "contains", expected: a.expected });
  }
  return out;
}

/** AI 草稿请求 → S2 requestSpec 模板（method/url 由目标接口定义补齐） */
export function aiDraftToRequestSpec(
  draft: { request: { headers?: { key: string; value: string }[]; query?: { key: string; value: string }[]; bodyJson?: string } },
  base: { method: string; url: string },
) {
  return {
    method: base.method,
    url: base.url,
    headers: draft.request.headers ?? [],
    query: draft.request.query ?? [],
    body: draft.request.bodyJson
      ? { kind: "raw_json" as const, content: draft.request.bodyJson }
      : { kind: "raw_json" as const, content: "" },
    auth: { kind: "none" as const },
    timeoutMs: 60000,
    followRedirects: false,
    skipPre: false,
    skipPost: false,
  };
}

// ── JSON 容错解析（AI-002/003 §2） ──

/** 从模型输出提取 JSON 数组：剥 markdown 栅栏 → 定位首个 [ → 括号平衡截取 → parse；失败返回 undefined */
export function extractJsonArray(text: string): unknown[] | undefined {
  let t = text.trim();
  // 剥 ```json ... ``` 或 ``` ... ``` 栅栏
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1]!.trim();
  const start = t.indexOf("[");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(t.slice(start, i + 1));
          return Array.isArray(parsed) ? parsed : undefined;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}
