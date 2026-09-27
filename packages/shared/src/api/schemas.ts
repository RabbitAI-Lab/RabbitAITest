/** Sprint 2 接口域契约（API-002/003/004/005、PROJ-003/004、SYS-006、RPT-002、CASE-006）。 */
import { z } from "zod";
import {
  assertSchema,
  envDatasourceSchema,
  envHostMappingSchema,
  envHttpDomainSchema,
  extractorSchema,
  httpMethodSchema,
  kvSchema,
  processorSchema,
  requestSpecSchema,
} from "../execution/schemas";

// ── 接口定义（API-002）──

export const apiStatusSchema = z.enum(["DEBUG", "RELEASED"]);

/** 定义默认响应（Mock 跟随源；API-002 §1.2 单响应简化） */
export const apiResponseSchema = z.object({
  status: z.number().int().min(100).max(599).default(200),
  headers: z.array(kvSchema).max(50).default([]),
  body: z.string().max(256 * 1024).default(""),
});

/** 定义/用例共用的请求包：spec + 断言/前后置/提取（落库 request JSONB 单列，API-003 §4） */
export const apiRequestBundleSchema = z.object({
  spec: requestSpecSchema,
  asserts: z.array(assertSchema).max(50).default([]),
  pre: z.array(processorSchema).max(20).default([]),
  post: z.array(processorSchema).max(20).default([]),
  extracts: z.array(extractorSchema).max(20).default([]),
});
export type ApiRequestBundle = z.infer<typeof apiRequestBundleSchema>;

export const apiUpsertSchema = z.object({
  moduleId: z.string().uuid(),
  name: z.string().min(1).max(512),
  status: apiStatusSchema.default("DEBUG"),
  tags: z.array(z.string().min(1).max(64)).max(10).default([]),
  request: apiRequestBundleSchema,
  response: apiResponseSchema.default({ status: 200, headers: [], body: "" }),
});
export const apiUpdateSchema = z.object({
  moduleId: z.string().uuid().optional(),
  name: z.string().min(1).max(512).optional(),
  status: apiStatusSchema.optional(),
  tags: z.array(z.string().min(1).max(64)).max(10).optional(),
  version: z.number().int().min(1),
  request: apiRequestBundleSchema.optional(),
  response: apiResponseSchema.optional(),
});

export const apiListQuerySchema = z.object({
  moduleId: z.string().uuid().optional(),
  includeChildren: z.coerce.boolean().default(true),
  method: httpMethodSchema.optional(),
  name: z.string().max(512).optional(),
  status: apiStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ── 接口用例（API-003）──

export const apiCaseLevelSchema = z.enum(["P0", "P1", "P2", "P3"]);
export const apiCaseStatusSchema = z.enum(["PREPARE", "UNDERWAY", "COMPLETED"]);

export const apiCaseUpsertSchema = z.object({
  name: z.string().min(1).max(512),
  level: apiCaseLevelSchema.default("P2"),
  status: apiCaseStatusSchema.default("UNDERWAY"),
  tags: z.array(z.string().min(1).max(64)).max(10).default([]),
  request: apiRequestBundleSchema,
});
export const apiCaseListQuerySchema = z.object({
  level: apiCaseLevelSchema.optional(),
  status: apiCaseStatusSchema.optional(),
  name: z.string().max(512).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const apiCaseExecuteSchema = z.object({
  caseIds: z.array(z.string().uuid()).min(1).max(200),
  envId: z.string().uuid().optional(),
  stopOnFail: z.boolean().default(false),
  clientTaskId: z.string().min(8).max(128).optional(),
});

// ── Mock（API-005）──

export const mockMatcherKvSchema = z.object({
  key: z.string().min(1).max(256),
  value: z.string().max(2048),
});

export const mockMatchersSchema = z.object({
  headers: z.array(mockMatcherKvSchema).max(20).default([]),
  query: z.array(mockMatcherKvSchema).max(20).default([]),
  bodyContains: z.string().max(2048).optional(),
});
export const mockResponseSchema = z.object({
  status: z.number().int().min(100).max(599).default(200),
  headers: z.array(mockMatcherKvSchema).max(20).default([]),
  body: z.string().max(256 * 1024).default(""),
  delayMs: z.number().int().min(0).max(10000).default(0),
});
export const mockUpsertSchema = z.object({
  name: z.string().min(1).max(256),
  enabled: z.boolean().default(true),
  followApi: z.boolean().default(false),
  matchers: mockMatchersSchema,
  response: mockResponseSchema.default({
    status: 200,
    headers: [],
    body: "",
    delayMs: 0,
  }),
});

/** Mock 规则快照（web → Redis → mock 服务，engine-execution-architecture §6） */
export const mockRuleSnapshotItem = z.object({
  id: z.string(),
  apiId: z.string(),
  enabled: z.boolean(),
  followApi: z.boolean(),
  method: httpMethodSchema,
  pathTemplate: z.string().max(1024),
  matchers: mockMatchersSchema,
  response: mockResponseSchema,
  apiResponse: apiResponseSchema,
});
export const mockProjectSnapshotSchema = z.object({
  projectId: z.string().uuid(),
  projectNum: z.number().int(),
  version: z.number().int(),
  rules: z.array(mockRuleSnapshotItem).max(500),
});
export type MockProjectSnapshot = z.infer<typeof mockProjectSnapshotSchema>;
export type MockRuleSnapshotItem = z.infer<typeof mockRuleSnapshotItem>;

// ── 导入导出（API-002）──

export const apiImportFormats = ["openapi3", "postman", "rabbit"] as const;
export const apiImportSchema = z.object({
  format: z.enum(apiImportFormats),
  source: z.object({
    url: z.string().url().max(2048).optional(),
    content: z.string().max(2 * 1024 * 1024).optional(),
  }),
  overwrite: z.boolean().default(false),
  moduleId: z.string().uuid(),
});
export const apiExportQuerySchema = z.object({
  moduleId: z.string().uuid().optional(),
  ids: z.array(z.string().uuid()).max(500).optional(),
});
export const curlParseSchema = z.object({
  curl: z.string().min(3).max(32 * 1024),
});

/** Rabbit 自有导入导出格式（roundtrip；再导入时 moduleId 由导入向导重选） */
export const rabbitApiExportItem = z.object({
  name: z.string().min(1).max(512),
  tags: z.array(z.string().min(1).max(64)).max(10).default([]),
  status: apiStatusSchema.default("DEBUG"),
  request: apiRequestBundleSchema,
  response: apiResponseSchema,
  cases: z
    .array(
      z.object({
        name: z.string().min(1).max(512),
        level: apiCaseLevelSchema.default("P2"),
        status: apiCaseStatusSchema.default("UNDERWAY"),
        tags: z.array(z.string().min(1).max(64)).max(10).default([]),
        request: apiRequestBundleSchema,
      }),
    )
    .max(200)
    .default([]),
  mocks: z
    .array(mockUpsertSchema.extend({ name: z.string().min(1).max(256) }))
    .max(100)
    .default([]),
});
export const rabbitApiExportFile = z.object({
  version: z.literal(1),
  apis: z.array(rabbitApiExportItem).max(500),
});

// ── 环境（PROJ-003）──

export const envVarSchema = z.object({
  key: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/),
  value: z.string().max(8192),
  enabled: z.boolean().default(true),
});

export const environmentConfigSchema = z.object({
  vars: z.array(envVarSchema).max(200).default([]),
  http: z.array(envHttpDomainSchema).max(20).default([]),
  hosts: z.array(envHostMappingSchema).max(50).default([]),
  database: z.array(envDatasourceSchema).max(10).default([]),
  pre: z.array(processorSchema).max(20).default([]),
  post: z.array(processorSchema).max(20).default([]),
  asserts: z.array(assertSchema).max(50).default([]),
  extracts: z.array(extractorSchema).max(20).default([]),
});
export const environmentUpsertSchema = z.object({
  name: z.string().min(1).max(128),
  config: environmentConfigSchema.default({}),
});
export const environmentImportSchema = z.object({
  overwrite: z.boolean().default(false),
  payload: z
    .array(z.object({ name: z.string().min(1).max(128), config: environmentConfigSchema }))
    .min(1)
    .max(50),
});
export const datasourceTestSchema = z.object({
  url: z.string().regex(/^postgresql:\/\//, "仅支持 PostgreSQL 数据源"),
});

// ── 文件管理（PROJ-004）──

export const FILE_ALLOWED_EXTS = [
  ".jar",
  ".csv",
  ".js",
  ".ts",
  ".json",
  ".txt",
  ".xmind",
  ".zip",
  ".png",
  ".jpg",
  ".jpeg",
  ".xlsx",
] as const;
export const fileUpdateSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  moduleId: z.string().uuid().optional(),
  jarEnabled: z.boolean().optional(),
});
export const fileListQuerySchema = z.object({
  moduleId: z.string().uuid().optional(),
  includeChildren: z.coerce.boolean().default(true),
  keyword: z.string().max(128).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ── 任务中心（SYS-006）与报告（RPT-002）──

export const execTaskListQuerySchema = z.object({
  type: z.enum(["api_debug", "api_case"]).optional(),
  status: z.enum(["PENDING", "RUNNING", "SUCCESS", "FAILED", "STOPPED"]).optional(),
  creator: z.string().max(128).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const reportListQuerySchema = z.object({
  reportType: z.enum(["api_debug", "api_case"]).optional(),
  keyword: z.string().max(128).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const shareCreateSchema = z.object({
  expireHours: z.union([z.literal(1), z.literal(24), z.literal(168), z.literal(720)]),
});

// ── 用例关联接口（CASE-006）──

export const caseApiRefCreateSchema = z.object({
  refIds: z.array(z.string().uuid()).min(1).max(100),
});
