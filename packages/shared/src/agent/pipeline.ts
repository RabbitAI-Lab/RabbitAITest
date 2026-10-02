/** AGENT-002 契约：生成管线（三阶段/上下文装配/草稿/导入）。 */
import { z } from "zod";
import { pipelineConfigSchema } from "./schemas";

// ── 上下文装配（Context Builder） ──

export const CONTEXT_SCORING = {
  extensionBonus: 30,
  directoryBonus: 25,
  keywordBonus: 20,
  openApiBonus: 40,
  sizePenalty: -10,
  excludedPatterns: ["node_modules", "dist", "build", ".git", "lock", "minified"],
  textExtensions: [".md", ".txt", ".yaml", ".yml", ".json", ".ts", ".js", ".py", ".http", ".rest"],
} as const;

export const contextSourceSchema = z.object({
  repoIds: z
    .array(z.object({ repoId: z.string().uuid(), branch: z.string().max(255) }))
    .max(10)
    .default([]),
  docPaths: z.array(z.string().max(512)).max(50).default([]),
  platformDocIds: z.array(z.string().uuid()).max(50).default([]),
  requirementText: z
    .string()
    .max(32 * 1024)
    .optional(),
  referenceCases: z.boolean().default(false),
});
export type ContextSource = z.infer<typeof contextSourceSchema>;

export const contextFileSchema = z.object({
  path: z.string(),
  score: z.number(),
  bytes: z.number(),
  truncated: z.boolean().default(false),
});
export type ContextFile = z.infer<typeof contextFileSchema>;

export const contextBundleSchema = z.object({
  manifest: z.array(contextFileSchema),
  sections: z.array(
    z.object({
      kind: z.enum(["repo", "repo_doc", "platform_doc", "requirement", "reference_cases"]),
      text: z.string(),
    }),
  ),
  tokenEstimate: z.number(),
  truncated: z.boolean().default(false),
});
export type ContextBundle = z.infer<typeof contextBundleSchema>;

// ── 三阶段 ──

export const PIPELINE_STAGES = ["A", "B", "C"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  A: "需求分析",
  B: "接口资产提取",
  C: "脚本生成",
};

export const genRunRequestSchema = z.object({
  sources: contextSourceSchema,
  stages: z
    .object({
      a: z.boolean().default(true),
      b: z.enum(["auto", "openapi", "extract", "off"]).default("auto"),
      c: z
        .object({
          scenario: z.boolean().default(true),
          ui: z.boolean().default(true),
          playwright: z.boolean().default(true),
        })
        .optional(),
    })
    .optional(),
  limits: z
    .object({
      cases: z.number().int().min(1).max(200).default(50),
      apis: z.number().int().min(1).max(500).default(100),
      scenarios: z.number().int().min(1).max(100).default(30),
    })
    .optional(),
  additionalInstruction: z.string().max(4096).optional(),
});
export type GenRunRequest = z.infer<typeof genRunRequestSchema>;

// ── 草稿 ──

export const AGENT_ASSET_TYPES = [
  "test_point",
  "functional_case",
  "api_definition",
  "api_case",
  "scenario",
  "ui_case",
  "playwright_script",
] as const;
export type AgentAssetType = (typeof AGENT_ASSET_TYPES)[number];

export const ASSET_TYPE_LABELS: Record<AgentAssetType, string> = {
  test_point: "测试点",
  functional_case: "功能用例",
  api_definition: "接口定义",
  api_case: "API 用例",
  scenario: "场景",
  ui_case: "UI 用例",
  playwright_script: "脚本",
};

export const functionalCaseDraftSchema = z.object({
  name: z.string().min(1).max(512),
  precondition: z.string().max(4000).default(""),
  steps: z
    .array(z.object({ desc: z.string().max(2000), expect: z.string().max(2000) }))
    .max(50)
    .default([]),
  level: z.enum(["P0", "P1", "P2", "P3"]).default("P2"),
  tags: z.array(z.string().max(64)).max(10).default([]),
  moduleId: z.string().uuid().optional(),
});
export type FunctionalCaseDraft = z.infer<typeof functionalCaseDraftSchema>;

export const testPointDraftSchema = z.object({
  name: z.string().min(1).max(512),
  moduleId: z.string().uuid().optional(),
  description: z.string().max(2000).default(""),
});
export type TestPointDraft = z.infer<typeof testPointDraftSchema>;

export const apiDefinitionDraftSchema = z.object({
  name: z.string().min(1).max(512),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]),
  path: z.string().min(1).max(1024),
  description: z.string().max(2000).optional(),
});
export type ApiDefinitionDraft = z.infer<typeof apiDefinitionDraftSchema>;

export const scenarioDraftSchema = z.object({
  name: z.string().min(1).max(512),
  steps: z
    .array(z.object({ desc: z.string().max(2000), expect: z.string().max(2000) }))
    .max(20)
    .default([]),
});
export type ScenarioDraft = z.infer<typeof scenarioDraftSchema>;

export const uiCaseDraftSchema = z.object({
  name: z.string().min(1).max(512),
  steps: z
    .array(
      z.object({
        op: z.enum([
          "goto",
          "click",
          "fill",
          "select",
          "assert-text",
          "assert-visible",
          "wait",
          "screenshot",
        ]),
        value: z.string().max(2048).optional(),
        elementRef: z.string().max(512).optional(),
      }),
    )
    .max(50)
    .default([]),
});
export type UiCaseDraft = z.infer<typeof uiCaseDraftSchema>;

export const draftViewSchema = z.object({
  id: z.string(),
  stage: z.enum(PIPELINE_STAGES),
  assetType: z.enum(AGENT_ASSET_TYPES),
  name: z.string(),
  payload: z.unknown(),
  meta: z.unknown().optional(),
  conflictStatus: z.enum(["NEW", "CONFLICT", "INVALID"]),
  conflictRef: z.unknown().optional(),
  selected: z.boolean(),
  importStatus: z.enum(["PENDING", "IMPORTED", "FAILED", "SKIPPED", "DISCARDED"]),
  importedRef: z.unknown().optional(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type DraftView = z.infer<typeof draftViewSchema>;

export const draftListSchema = z.object({
  total: z.number(),
  items: z.array(draftViewSchema),
  stats: z.object({
    byType: z.record(
      z.string(),
      z.object({ total: z.number(), adopted: z.number(), pending: z.number() }),
    ),
    adoptionRate: z.number().optional(),
  }),
});

export const draftImportRequestSchema = z.object({
  draftIds: z.array(z.string().uuid()).min(1).max(500),
  importMode: z.enum(["direct", "review"]).default("review"),
});
export type DraftImportRequest = z.infer<typeof draftImportRequestSchema>;

export const suggestRequirementSchema = z.object({
  repoIds: z.array(z.string().uuid()).max(10).default([]),
  docPaths: z.array(z.string().max(512)).max(50).default([]),
  platformDocIds: z.array(z.string().uuid()).max(50).default([]),
});
export type SuggestRequirementInput = z.infer<typeof suggestRequirementSchema>;

export const DEFAULT_PROMPT = "请根据文档，及所选代码库，生成测试用例。";

export const genRunQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  assetType: z.enum(AGENT_ASSET_TYPES).optional(),
  status: z.enum(["PENDING", "IMPORTED", "FAILED", "SKIPPED", "DISCARDED"]).optional(),
});
