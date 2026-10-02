/** AGENT-001 契约：项目 Agent 六要素 / 技能库 / 运行。 */
import { z } from "zod";

// ── 枚举（SCREAMING_SNAKE；入库 String + 应用层校验惯例） ──

export const AGENT_ROLES = ["CASE_GENERATOR", "CASE_RUNNER", "ANALYST", "CUSTOM"] as const;
export const AGENT_MODES = ["chat", "pipeline"] as const;
export const AGENT_RUN_SOURCES = ["UI", "A2A"] as const;
export const AGENT_RUN_STATUSES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "REJECTED",
] as const;

export const AGENT_ROLE_LABELS: Record<(typeof AGENT_ROLES)[number], string> = {
  CASE_GENERATOR: "用例生成",
  CASE_RUNNER: "用例执行",
  ANALYST: "测试分析",
  CUSTOM: "自定义",
};

// ── 上限常量（§1.2） ──

export const AGENT_SYSTEM_PROMPT_MAX = 16 * 1024; // 16KB
export const AGENT_SKILL_CONTENT_MAX = 16 * 1024;
export const AGENT_SKILL_REFS_MAX = 5; // 每个 Agent 引用技能上限
export const AGENT_MAX_ITERATIONS_MAX = 30;
export const AGENT_TIMEOUT_MS_MAX = 600_000;
export const AGENT_KEY_PREFIX = "rag_";

// ── 六要素 ──

export const agentModelParamsSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.3),
  maxTokens: z.number().int().min(256).max(32768).default(4096),
});
export type AgentModelParams = z.infer<typeof agentModelParamsSchema>;

/** pipeline 模式配置（AGENT-002 消费；此处只锁形状） */
export const pipelineConfigSchema = z
  .object({
    repos: z
      .array(z.object({ repoId: z.string().uuid(), branch: z.string().min(1).max(255) }))
      .max(10)
      .optional(),
    stages: z
      .object({
        a: z.boolean().default(true),
        b: z.enum(["auto", "openapi", "extract", "off"]).default("auto"),
        c: z.object({ scenario: z.boolean(), ui: z.boolean(), playwright: z.boolean() }).optional(),
      })
      .optional(),
    limits: z
      .object({ cases: z.number().int(), apis: z.number().int(), scenarios: z.number().int() })
      .optional(),
    contextBudgetTokens: z.number().int().min(16_000).max(96_000).optional(),
    docPathFilter: z.string().max(512).optional(),
    requirementTemplate: z.string().max(4096).optional(),
  })
  .strict();
export type PipelineConfig = z.infer<typeof pipelineConfigSchema>;

const agentBaseSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(512).optional(),
  role: z.enum(AGENT_ROLES).default("CUSTOM"),
  mode: z.enum(AGENT_MODES).default("chat"),
  modelId: z.string().uuid(),
  systemPrompt: z.string().min(1).max(AGENT_SYSTEM_PROMPT_MAX),
  modelParams: agentModelParamsSchema.default({ temperature: 0.3, maxTokens: 4096 }),
  maxIterations: z.number().int().min(1).max(AGENT_MAX_ITERATIONS_MAX).default(12),
  timeoutMs: z
    .number()
    .int()
    .min(10_000)
    .max(AGENT_TIMEOUT_MS_MAX)
    .default(300_000),
  repoIds: z.array(z.string().uuid()).max(10).default([]),
  toolKeys: z.array(z.string().max(64)).max(32).default([]),
  skillIds: z.array(z.string().uuid()).max(AGENT_SKILL_REFS_MAX).default([]),
  runAsUserId: z.string().uuid().optional(), // 缺省=创建人
  pipelineConfig: pipelineConfigSchema.nullish(),
  enabled: z.boolean().default(true),
});

export const agentCreateSchema = agentBaseSchema.extend({
  fromTemplate: z.string().max(32).optional(), // 模板 key（templates.ts）
});
export type AgentCreateInput = z.infer<typeof agentCreateSchema>;

export const agentUpdateSchema = agentBaseSchema.partial().extend({
  // 编辑不换模式两份配置混挂：mode 可改但 pipelineConfig 随传随换
  version: z.number().int().optional(),
});
export type AgentUpdateInput = z.infer<typeof agentUpdateSchema>;

/** 列表/详情视图（密钥只回元信息） */
export const agentViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  role: z.enum(AGENT_ROLES),
  mode: z.enum(AGENT_MODES),
  modelId: z.string(),
  modelName: z.string().nullable(),
  systemPrompt: z.string(),
  modelParams: agentModelParamsSchema,
  maxIterations: z.number(),
  timeoutMs: z.number(),
  repoIds: z.array(z.string()),
  toolKeys: z.array(z.string()),
  skillIds: z.array(z.string()),
  runAsUserId: z.string(),
  runAsUserName: z.string().nullable(),
  a2aEnabled: z.boolean(),
  apiKeyPrefix: z.string().nullable(),
  keyGeneratedAt: z.string().nullable(),
  lastCalledAt: z.string().nullable(),
  enabled: z.boolean(),
  version: z.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentView = z.infer<typeof agentViewSchema>;

/** A2A 密钥生成响应（明文仅此一次） */
export const agentKeyViewSchema = z.object({
  apiKey: z.string(), // rag_ + 32 位 base62（只在生成/轮换响应出现）
  prefix: z.string(),
  generatedAt: z.string(),
});

// ── 技能库 ──

export const agentSkillCreateSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(512),
  content: z.string().min(1).max(AGENT_SKILL_CONTENT_MAX),
  enabled: z.boolean().default(true),
});
export type AgentSkillCreateInput = z.infer<typeof agentSkillCreateSchema>;

export const agentSkillUpdateSchema = agentSkillCreateSchema.partial();
export type AgentSkillUpdateInput = z.infer<typeof agentSkillUpdateSchema>;

export const agentSkillViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  content: z.string(),
  enabled: z.boolean(),
  /** 引用该技能的 Agent 数（列表聚合） */
  refCount: z.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentSkillView = z.infer<typeof agentSkillViewSchema>;

// ── 运行 ──

export const agentRunCreateSchema = z.object({
  message: z.string().min(1).max(32 * 1024),
});
export type AgentRunCreateInput = z.infer<typeof agentRunCreateSchema>;

/** 同 Run 多轮续投（UI 调试台） */
export const agentRunFollowUpSchema = agentRunCreateSchema;

export const agentRunQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(AGENT_RUN_STATUSES).optional(),
  source: z.enum(AGENT_RUN_SOURCES).optional(),
});
export type AgentRunQuery = z.infer<typeof agentRunQuerySchema>;

export const agentRunViewSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  source: z.enum(AGENT_RUN_SOURCES),
  status: z.enum(AGENT_RUN_STATUSES),
  promptTokens: z.number(),
  completionTokens: z.number(),
  durationMs: z.number().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AgentRunView = z.infer<typeof agentRunViewSchema>;

/** 运行轨迹条目（调试台/详情回放） */
export const agentRunMessageViewSchema = z.object({
  seq: z.number(),
  role: z.enum(["user", "assistant", "tool"]),
  name: z.string().nullable(),
  content: z.unknown(),
  createdAt: z.string(),
});
