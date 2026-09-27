import { z } from "zod";

/**
 * 执行契约 v2（API-004 冻结，web ↔ engine 双方不得私改；engine-execution-architecture §3）。
 * v1（EXEC-001 api_debug 单请求）是本文件 api_debug 分支的子集：事件帧新增字段全部可选、
 * 新增帧类型/additive 枚举，旧帧按宽松读兼容（报告=事件视图，历史数据不迁移）。
 */

export const httpMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
  "HEAD",
  "CONNECT",
]);
export type HttpMethod = z.infer<typeof httpMethodSchema>;

/** KV 行（headers/query）：enabled=false 行执行时剔除（编辑器暂存不丢失）。 */
export const kvSchema = z.object({
  key: z.string().min(1).max(256),
  value: z.string().max(8192),
  enabled: z.boolean().default(true),
});
export type Kv = z.infer<typeof kvSchema>;

/** 请求体 7 类（功能清单 §6.6）。 */
export const bodyKindSchema = z.enum([
  "none",
  "form_data",
  "form_urlencoded",
  "raw_json",
  "raw_xml",
  "raw_text",
  "binary",
]);
export type BodyKind = z.infer<typeof bodyKindSchema>;

export const formRowSchema = z.object({
  key: z.string().min(1).max(256),
  value: z.string().max(8192).default(""),
  /** form_data 专有：text=普通值；file=引用文件管理 fileId（PROJ-004） */
  type: z.enum(["text", "file"]).default("text"),
  fileId: z.string().uuid().optional(),
  enabled: z.boolean().default(true),
});
export type FormRow = z.infer<typeof formRowSchema>;

export const requestBodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("form_data"),
    rows: z.array(formRowSchema).max(50).default([]),
  }),
  z.object({
    kind: z.literal("form_urlencoded"),
    rows: z.array(formRowSchema).max(100).default([]),
  }),
  z.object({
    kind: z.literal("raw_json"),
    content: z.string().max(256 * 1024).default(""),
  }),
  z.object({ kind: z.literal("raw_xml"), content: z.string().max(256 * 1024).default("") }),
  z.object({ kind: z.literal("raw_text"), content: z.string().max(256 * 1024).default("") }),
  z.object({ kind: z.literal("binary"), fileId: z.string().uuid() }),
]);
export type RequestBody = z.infer<typeof requestBodySchema>;

export const authSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("basic"),
    username: z.string().min(1).max(256),
    password: z.string().max(256),
  }),
  z.object({
    kind: z.literal("digest"),
    username: z.string().min(1).max(256),
    password: z.string().max(256),
  }),
]);
export type RequestAuth = z.infer<typeof authSchema>;

/**
 * 全量请求规格 v2（定义/用例/调试共用）。
 * url 允许相对路径（环境域名拼接，PROJ-003）或绝对 URL，支持 `${var}` 渲染。
 */
export const requestSpecSchema = z.object({
  method: httpMethodSchema,
  url: z.string().min(1).max(2048),
  headers: z.array(kvSchema).max(50).default([]),
  query: z.array(kvSchema).max(50).default([]),
  body: requestBodySchema.default({ kind: "raw_json", content: "" }),
  auth: authSchema.default({ kind: "none" }),
  timeoutMs: z.number().int().min(1000).max(120000).default(60000),
  followRedirects: z.boolean().default(false),
  skipPre: z.boolean().default(false),
  skipPost: z.boolean().default(false),
});
export type RequestSpec = z.infer<typeof requestSpecSchema>;

/** 前后置处理器（功能清单 §6.6：脚本 quickjs / SQL(PostgreSQL) / 等待）。 */
export const processorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("script"),
    script: z.string().max(64 * 1024),
  }),
  z.object({
    kind: z.literal("sql"),
    sql: z.string().min(1).max(16 * 1024),
    datasourceId: z.string().min(1).max(128),
    /** 首行结果列 → 变量名映射（{colName: varName}），仅前置/后置 SQL 提取用 */
    varMapping: z.record(z.string().min(1).max(128), z.string().min(1).max(128)).default({}),
  }),
  z.object({
    kind: z.literal("wait"),
    ms: z.number().int().min(1).max(30000),
  }),
]);
export type Processor = z.infer<typeof processorSchema>;

/** 参数提取（正则/JSONPath × 匹配模式 × 作用域）。XPath 豁免登记于 API-004 §1.4。 */
export const extractorSchema = z.object({
  source: z.enum(["body", "headers"]),
  kind: z.enum(["regex", "jsonpath"]),
  expression: z.string().min(1).max(1024),
  match: z.enum(["first", "random", "n"]).default("first"),
  index: z.number().int().min(1).max(100).optional(), // match=n 时第几个匹配（1 起）
  variable: z.string().min(1).max(128),
  scope: z.enum(["temp", "env"]).default("temp"),
});
export type Extractor = z.infer<typeof extractorSchema>;

/** 断言 6 种 v2（S0 的 status_code/body_jsonpath 是子集；path 复用为多义目标列）。 */
export const assertKindSchema = z.enum([
  "status_code",
  "response_header",
  "body_jsonpath",
  "body_regex",
  "response_time",
  "variable",
]);
export const assertOpSchema = z.enum(["eq", "contains", "lt", "le", "gt", "ge", "regex"]);
export const assertSchema = z.object({
  kind: assertKindSchema,
  /** 目标：body_jsonpath 的 JSONPath / response_header 的头名 / variable 的变量名；其余空 */
  path: z.string().max(512).default(""),
  op: assertOpSchema.default("eq"),
  /** 期望值（response_time 单位 ms；variable 取运行时变量值比较） */
  expected: z.string().max(2048).default(""),
});
export type AssertSpec = z.infer<typeof assertSchema>;
export type AssertKind = z.infer<typeof assertKindSchema>;

/** 环境快照（web 任务下发时构建；engine 无 DB，全部运行时配置经此注入，PROJ-003 §1.1）。 */
export const envHttpDomainSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  protocol: z.enum(["http", "https"]).default("http"),
  hostname: z.string().min(1).max(256),
  port: z.number().int().min(1).max(65535).default(80),
  pathPrefix: z.string().max(512).default(""),
  conditions: z
    .object({
      moduleId: z.string().uuid().optional(),
      pathPrefix: z.string().max(512).optional(),
    })
    .default({}),
});
export type EnvHttpDomain = z.infer<typeof envHttpDomainSchema>;

export const envHostMappingSchema = z.object({
  host: z.string().min(1).max(256),
  address: z.string().min(1).max(256),
});

export const envDatasourceSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  driver: z.literal("postgresql"),
  url: z.string().min(1).max(512),
});

export const envSnapshotSchema = z.object({
  vars: z.record(z.string().min(1).max(128), z.string().max(8192)).default({}),
  http: z.array(envHttpDomainSchema).max(20).default([]),
  hosts: z.array(envHostMappingSchema).max(50).default([]),
  database: z.array(envDatasourceSchema).max(10).default([]),
  /** 环境全局前置/后置/断言：追加到该环境下每个请求（API-004 §2 管线次序） */
  pre: z.array(processorSchema).max(20).default([]),
  post: z.array(processorSchema).max(20).default([]),
  asserts: z.array(assertSchema).max(50).default([]),
  extracts: z.array(extractorSchema).max(20).default([]),
});
export type EnvSnapshot = z.infer<typeof envSnapshotSchema>;

/** api_case 任务条目（web 预建 ExecItem，itemId=ExecItem.id）。 */
export const execItemCommandSchema = z.object({
  itemId: z.string().uuid(),
  caseId: z.string().uuid(),
  name: z.string().min(1).max(512),
  moduleId: z.string().uuid(),
  request: requestSpecSchema,
  asserts: z.array(assertSchema).max(50).default([]),
  pre: z.array(processorSchema).max(20).default([]),
  post: z.array(processorSchema).max(20).default([]),
  extracts: z.array(extractorSchema).max(20).default([]),
});
export type ExecItemCommand = z.infer<typeof execItemCommandSchema>;

/** 执行指令（web → engine，经 BullMQ；按 type 判别）。 */
export const execCommandSchema = z.discriminatedUnion("type", [
  z.object({
    taskId: z.string().uuid(),
    projectId: z.string().uuid(),
    type: z.literal("api_debug"),
    request: requestSpecSchema,
    asserts: z.array(assertSchema).max(50).default([]),
    pre: z.array(processorSchema).max(20).default([]),
    post: z.array(processorSchema).max(20).default([]),
    extracts: z.array(extractorSchema).max(20).default([]),
    envSnapshot: envSnapshotSchema.optional(),
  }),
  z.object({
    taskId: z.string().uuid(),
    projectId: z.string().uuid(),
    type: z.literal("api_case"),
    envSnapshot: envSnapshotSchema.optional(),
    stopOnFail: z.boolean().default(false),
    items: z.array(execItemCommandSchema).min(1).max(200),
  }),
]);
export type ExecCommand = z.infer<typeof execCommandSchema>;

// ───────────────────────── 事件帧（engine → Redis Stream → web SSE） ─────────────────────────

export const frameBase = {
  taskId: z.string().uuid(),
  seq: z.number().int(),
  ts: z.number(),
} as const;

export const taskStartFrame = z.object({
  ...frameBase,
  type: z.literal("task-start"),
});

export const itemStartFrame = z.object({
  ...frameBase,
  type: z.literal("item-start"),
  itemId: z.string().uuid(),
  name: z.string().max(512),
});

export const itemStatusSchema = z.enum(["SUCCESS", "FAILED", "SKIPPED", "STOPPED"]);

export const itemFinalFrame = z.object({
  ...frameBase,
  type: z.literal("item-final"),
  itemId: z.string().uuid(),
  status: itemStatusSchema,
  message: z.string().max(2000).default(""),
});

export const stepStartFrame = z.object({
  ...frameBase,
  type: z.literal("step-start"),
  itemId: z.string().uuid().optional(),
  method: httpMethodSchema,
  url: z.string(),
});

export const assertResultSchema = z.object({
  kind: assertKindSchema,
  path: z.string(),
  op: assertOpSchema,
  expected: z.string(),
  actual: z.string(),
  passed: z.boolean(),
});
export type AssertResult = z.infer<typeof assertResultSchema>;

export const extractResultSchema = z.object({
  variable: z.string(),
  value: z.string(),
  scope: z.enum(["temp", "env"]),
});
export type ExtractResult = z.infer<typeof extractResultSchema>;

export const stepResultFrame = z.object({
  ...frameBase,
  type: z.literal("step-result"),
  itemId: z.string().uuid().optional(),
  status: z.number().int(),
  durationMs: z.number().int(),
  /** 渲染后请求快照（变量已代入、域名已拼接、认证头已加——报告展示实际请求） */
  requestSnapshot: z.object({
    method: httpMethodSchema,
    url: z.string(),
    headers: z.array(z.object({ key: z.string(), value: z.string() })),
    body: z.string(),
  }),
  responseSummary: z.object({
    status: z.number().int(),
    headers: z.array(z.object({ key: z.string(), value: z.string() })),
    bodyText: z.string(),
    truncated: z.boolean(),
  }),
  asserts: z.array(assertResultSchema),
  extracts: z.array(extractResultSchema).default([]),
});
export const logFrame = z.object({
  ...frameBase,
  type: z.literal("log"),
  itemId: z.string().uuid().optional(),
  level: z.enum(["info", "warn", "error"]),
  message: z.string().max(4000),
});
export const failureKindSchema = z.enum([
  "NETWORK_ERROR",
  "ASSERT_FAILED",
  "CONFIG_ERROR",
  "SCRIPT_ERROR",
]);
export type FailureKind = z.infer<typeof failureKindSchema>;

export const taskStatsSchema = z.object({
  total: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
});
export const taskFinalFrame = z.object({
  ...frameBase,
  type: z.literal("task-final"),
  outcome: z.enum(["success", "failed", "stopped"]),
  failureKind: failureKindSchema.optional(),
  message: z.string().max(4000).default(""),
  stats: taskStatsSchema.optional(),
});
export const eventFrameSchema = z.discriminatedUnion("type", [
  taskStartFrame,
  itemStartFrame,
  itemFinalFrame,
  stepStartFrame,
  stepResultFrame,
  logFrame,
  taskFinalFrame,
]);
export type EventFrame = z.infer<typeof eventFrameSchema>;

/** 帧写入入参：剔除由写入器统一补齐的 taskId/seq/ts（分配式 Omit，保留各帧专有字段）。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type FrameInput = DistributiveOmit<EventFrame, "taskId" | "seq" | "ts">;

/** 回调（engine → web，终态）。varUpdates=提取 scope=env 的写回（API-004 §2）。 */
export const execCallbackSchema = z.object({
  outcome: z.enum(["success", "failed", "stopped"]),
  failureKind: failureKindSchema.optional(),
  message: z.string().max(4000).default(""),
  lastSeq: z.number().int(),
  varUpdates: z.array(z.object({ name: z.string().max(128), value: z.string().max(8192) })).default([]),
});
export type ExecCallback = z.infer<typeof execCallbackSchema>;

/** 心跳与注册（EXEC-002 v2：slots=总并发，busy=在执数；响应下发 maxConcurrency）。 */
export const heartbeatSchema = z.object({
  nodeId: z.string(),
  version: z.string(),
  slots: z.number().int(),
  busy: z.number().int().default(0),
  ts: z.number(),
});
export type Heartbeat = z.infer<typeof heartbeatSchema>;

export const heartbeatResponseSchema = z.object({
  maxConcurrency: z.number().int().min(2).max(64),
  contractVersion: z.number().int(),
});

/** 任务停止控制键（web 写 / engine 轮询，EXEC-002 §2）。 */
export function execStopKey(taskId: string): string {
  return `exec:stop:${taskId}`;
}

export const taskStatusSchema = z.enum(["PENDING", "RUNNING", "SUCCESS", "FAILED", "STOPPED"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** 引擎契约版本（心跳协商：不一致节点 web 标「版本不匹配」不下发新类型任务展示） */
export const EXEC_CONTRACT_VERSION = 2;
