import { z } from "zod";

/** 执行指令（web → engine，经 BullMQ）。EXEC-001 §4 契约，冻结后双方不得私改。 */
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

export const kvSchema = z.object({
  key: z.string().min(1).max(256),
  value: z.string().max(8192),
});

export const debugBodySchema = z
  .object({
    kind: z.enum(["none", "raw_json"]).default("none"),
    content: z
      .string()
      .max(256 * 1024)
      .default(""),
  })
  .default({ kind: "none", content: "" });

export const debugRequestSchema = z.object({
  method: httpMethodSchema,
  url: z.string().url(),
  headers: z.array(kvSchema).max(50).default([]),
  body: debugBodySchema,
  timeoutMs: z.number().int().min(1000).max(120000).default(60000),
});
export type DebugRequest = z.infer<typeof debugRequestSchema>;

export const assertSchema = z.object({
  kind: z.enum(["status_code", "body_jsonpath"]),
  path: z.string().max(512).default(""),
  op: z.enum(["eq", "contains"]),
  expected: z.string().max(2048),
});
export type AssertSpec = z.infer<typeof assertSchema>;

export const execCommandSchema = z.object({
  taskId: z.string().uuid(),
  projectId: z.string().uuid(),
  type: z.literal("api_debug"),
  request: debugRequestSchema,
  asserts: z.array(assertSchema).max(20).default([]),
});
export type ExecCommand = z.infer<typeof execCommandSchema>;

/** 事件帧（engine → Redis Stream → web SSE）。 */
export const frameBase = {
  taskId: z.string().uuid(),
  seq: z.number().int(),
  ts: z.number(),
} as const;

export const taskStartFrame = z.object({
  ...frameBase,
  type: z.literal("task-start"),
});
export const stepStartFrame = z.object({
  ...frameBase,
  type: z.literal("step-start"),
  method: httpMethodSchema,
  url: z.string(),
});
export const assertResultSchema = z.object({
  kind: z.enum(["status_code", "body_jsonpath"]),
  path: z.string(),
  op: z.enum(["eq", "contains"]),
  expected: z.string(),
  actual: z.string(),
  passed: z.boolean(),
});
export type AssertResult = z.infer<typeof assertResultSchema>;
export const stepResultFrame = z.object({
  ...frameBase,
  type: z.literal("step-result"),
  status: z.number().int(),
  durationMs: z.number().int(),
  requestSnapshot: z.object({
    method: httpMethodSchema,
    url: z.string(),
    headers: z.array(kvSchema),
    body: z.string(),
  }),
  responseSummary: z.object({
    status: z.number().int(),
    headers: z.array(kvSchema),
    bodyText: z.string(),
    truncated: z.boolean(),
  }),
  asserts: z.array(assertResultSchema),
});
export const logFrame = z.object({
  ...frameBase,
  type: z.literal("log"),
  level: z.enum(["info", "warn", "error"]),
  message: z.string().max(4000),
});
export const failureKindSchema = z.enum(["NETWORK_ERROR", "ASSERT_FAILED", "CONFIG_ERROR"]);
export type FailureKind = z.infer<typeof failureKindSchema>;
export const taskFinalFrame = z.object({
  ...frameBase,
  type: z.literal("task-final"),
  outcome: z.enum(["success", "failed"]),
  failureKind: failureKindSchema.optional(),
  message: z.string().max(4000).default(""),
});
export const eventFrameSchema = z.discriminatedUnion("type", [
  taskStartFrame,
  stepStartFrame,
  stepResultFrame,
  logFrame,
  taskFinalFrame,
]);
export type EventFrame = z.infer<typeof eventFrameSchema>;

/** 帧写入入参：剔除由写入器统一补齐的 taskId/seq/ts（分配式 Omit，保留各帧专有字段）。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type FrameInput = DistributiveOmit<EventFrame, "taskId" | "seq" | "ts">;

/** 回调（engine → web，终态）。 */
export const execCallbackSchema = z.object({
  outcome: z.enum(["success", "failed"]),
  failureKind: failureKindSchema.optional(),
  message: z.string().max(4000).default(""),
  lastSeq: z.number().int(),
});
export type ExecCallback = z.infer<typeof execCallbackSchema>;

/** 心跳与注册。 */
export const heartbeatSchema = z.object({
  nodeId: z.string(),
  version: z.string(),
  slots: z.number().int(),
  ts: z.number(),
});

export const taskStatusSchema = z.enum(["PENDING", "RUNNING", "SUCCESS", "FAILED"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;
