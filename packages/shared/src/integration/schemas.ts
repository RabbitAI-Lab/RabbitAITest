/** S6 集成与插件域契约：插件管理 / 服务集成 / 项目同步关联 / APIKEY / 审计 / Swagger 定时同步。 */
import { z } from "zod";
import { PLATFORMS } from "../plugins/spi";
import { pluginManifestSchema } from "../plugins/spi";

// ── 插件管理（PLUG-001）──

export const pluginScopeSchema = z.union([z.literal("ALL"), z.array(z.string().uuid()).max(100)]);
export type PluginScope = z.infer<typeof pluginScopeSchema>;

export const pluginUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  orgScope: pluginScopeSchema.optional(),
});
export const pluginListQuerySchema = z.object({
  kind: z.enum(["protocol", "platform", "driver"]).optional(),
  keyword: z.string().max(128).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** 插件运行态（runtime 拼装，不落库） */
export const pluginRuntimeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: z.string(),
  version: z.string(),
  spiVersion: z.string(),
  orgScope: pluginScopeSchema,
  description: z.string().nullable(),
  enabled: z.boolean(),
  runtimeStatus: z.enum(["RUNNING", "STOPPED", "ERROR"]),
  runtimeError: z.string().nullable(),
  updatedAt: z.string(),
});
export type PluginRuntime = z.infer<typeof pluginRuntimeSchema>;

// ── 组织服务集成（INTG-001/002）──

export const integrationSaveSchema = z.object({
  platform: z.enum(PLATFORMS),
  address: z.string().url().max(512),
  authType: z.enum(["BASIC", "BEARER"]),
  username: z.string().max(128).optional(),
  password: z.string().max(256).optional(),
  token: z.string().max(512).optional(),
});
export type IntegrationSave = z.infer<typeof integrationSaveSchema>;

export const integrationViewSchema = z.object({
  platform: z.enum(PLATFORMS),
  address: z.string(),
  authType: z.string(),
  hasCredential: z.boolean(),
  testStatus: z.enum(["NONE", "OK", "FAILED"]),
  testMessage: z.string().nullable(),
  testedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type IntegrationView = z.infer<typeof integrationViewSchema>;

// ── 项目同步关联（INTG-001/002，PlatformSyncConfig 应用设置形态）──

export const platformSyncSaveSchema = z.object({
  platform: z.enum(PLATFORMS),
  projectKey: z.string().min(1).max(128),
  /** 本地缺陷类型 → 平台缺陷类型（如 功能缺陷 → Bug） */
  bugTypes: z
    .array(z.object({ local: z.string().min(1).max(64), platform: z.string().min(1).max(64) }))
    .max(20)
    .default([]),
  /** 平台状态 → 本地工作流状态 serial（覆盖默认映射） */
  statusMapping: z
    .array(z.object({ platform: z.string().min(1).max(64), local: z.string().min(1).max(64) }))
    .max(30)
    .default([]),
  mode: z.enum(["INCREMENT", "FULL"]).default("INCREMENT"),
  cron: z.string().max(64).nullable().optional(),
  enabled: z.boolean().default(false),
});
export type PlatformSyncSave = z.infer<typeof platformSyncSaveSchema>;

export const syncHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

// ── APIKEY（INTG-003）──

export const apiKeyCreateSchema = z.object({
  name: z.string().min(1).max(128),
});
export const apiKeyViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
});
export const apiKeyCreatedSchema = apiKeyViewSchema.extend({
  accessKey: z.string(),
  secretKey: z.string(), // 仅创建响应一次返回
});

// ── 开放 API（INTG-003：APIKEY 通道触发执行）──

export const openExecApiCaseSchema = z.object({
  apiCaseId: z.string().uuid(),
  envId: z.string().uuid(),
  resourcePoolId: z.string().uuid().nullable().optional(),
});
export const openExecScenarioSchema = z.object({
  scenarioId: z.string().uuid(),
  envId: z.string().uuid().nullable().optional(),
  resourcePoolId: z.string().uuid().nullable().optional(),
});

// ── Swagger 定时同步（API-011，AppSetting 存储形态）──

export const swaggerSyncTaskSaveSchema = z.object({
  name: z.string().min(1).max(128),
  url: z.string().url().max(1024),
  cover: z.boolean().default(false),
  moduleId: z.string().uuid().nullable().optional(),
  cron: z.string().min(9).max(64),
});
export type SwaggerSyncTaskSave = z.infer<typeof swaggerSyncTaskSaveSchema>;

export const swaggerSyncTaskViewSchema = swaggerSyncTaskSaveSchema.extend({
  id: z.string(),
  enabled: z.boolean(),
  lastRunAt: z.string().nullable(),
  lastResult: z
    .object({
      added: z.number(),
      updated: z.number(),
      skipped: z.number(),
      failed: z.array(z.object({ path: z.string(), reason: z.string() })).default([]),
      ok: z.boolean(),
      error: z.string().optional(),
      ms: z.number(),
    })
    .nullable(),
});
export type SwaggerSyncTaskView = z.infer<typeof swaggerSyncTaskViewSchema>;

// ── 审计日志（SYS-008）──

export const auditLogQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  action: z.string().max(64).optional(), // 前缀匹配
  objectType: z.string().max(64).optional(),
  keyword: z.string().max(128).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const auditRetentionParamSchema = z.object({
  auditRetentionDays: z.number().int().min(0).max(3650).default(90), // 0=永久
});

// ── 校验工具 ──

export { pluginManifestSchema };
