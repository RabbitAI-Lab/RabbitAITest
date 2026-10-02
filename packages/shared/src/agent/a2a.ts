/** A2A v1.0.0 wire 契约（AGENT-001 §2.5）：Agent Card / JSON-RPC 2.0 / Task / Message / Part。
 * Part 为 member-name 判别（v1.0 无 kind 字段）：{"text"} | {"data"} | {"raw",mediaType} | {"url",...}。 */
import { z } from "zod";

export const A2A_PROTOCOL_VERSION = "1.0";
export const A2A_JSONRPC = "2.0" as const;

/** A2A 专属 JSON-RPC 错误码（协议 §5.4） */
export const A2A_ERRORS = {
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOT_SUPPORTED: -32003,
  UNSUPPORTED_OPERATION: -32004,
  CONTENT_TYPE_NOT_SUPPORTED: -32005,
  INVALID_AGENT_RESPONSE: -32006,
  VERSION_NOT_SUPPORTED: -32009,
  /** 平台自定义：鉴权/限流（携 401/429 语义） */
  AGENT_AUTH: -32000,
} as const;

// ── Part / Message ──

export const textPartSchema = z.object({ text: z.string() });
export const dataPartSchema = z.object({ data: z.unknown() });
export const rawPartSchema = z.object({ raw: z.string(), mediaType: z.string().optional() });
export const urlPartSchema = z.object({
  url: z.string(),
  filename: z.string().optional(),
  mediaType: z.string().optional(),
});
export const a2aPartSchema = z.union([
  textPartSchema,
  dataPartSchema,
  rawPartSchema,
  urlPartSchema,
]);
export type A2aPart = z.infer<typeof a2aPartSchema>;

export const a2aMessageSchema = z.object({
  role: z.enum(["ROLE_USER", "ROLE_AGENT"]),
  parts: z.array(a2aPartSchema).min(1),
  messageId: z.string().min(1),
  taskId: z.string().optional(),
  contextId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type A2aMessage = z.infer<typeof a2aMessageSchema>;

// ── Task ──

export const A2A_TASK_STATES = [
  "TASK_STATE_SUBMITTED",
  "TASK_STATE_WORKING",
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_REJECTED",
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_AUTH_REQUIRED",
] as const;
export type A2aTaskState = (typeof A2A_TASK_STATES)[number];

export const a2aTaskStatusSchema = z.object({
  state: z.enum(A2A_TASK_STATES),
  message: a2aMessageSchema.optional(),
  timestamp: z.string().optional(),
});

export const a2aArtifactSchema = z.object({
  artifactId: z.string().optional(),
  name: z.string().optional(),
  parts: z.array(a2aPartSchema),
});

export const a2aTaskSchema = z.object({
  id: z.string(),
  contextId: z.string(),
  status: a2aTaskStatusSchema,
  artifacts: z.array(a2aArtifactSchema).optional(),
  history: z.array(a2aMessageSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type A2aTask = z.infer<typeof a2aTaskSchema>;

// ── JSON-RPC 信封与方法参数 ──

export const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal(A2A_JSONRPC),
  id: z.union([z.string(), z.number()]).nullable().optional(),
  method: z.string().min(1),
  params: z.unknown(),
});

export const sendMessageParamsSchema = z.object({
  message: a2aMessageSchema,
  configuration: z
    .object({
      return_immediately: z.boolean().optional(),
      acceptedOutputModes: z.array(z.string()).optional(),
      historyLength: z.number().int().optional(),
      blocking: z.boolean().optional(),
    })
    .optional(),
});
export type SendMessageParams = z.infer<typeof sendMessageParamsSchema>;

export const getTaskParamsSchema = z.object({
  taskId: z.string(),
  historyLength: z.number().int().optional(),
});

export const listTasksParamsSchema = z.object({
  contextId: z.string().optional(),
  status: z.enum(A2A_TASK_STATES).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
});

export const cancelTaskParamsSchema = z.object({ taskId: z.string() });
export const subscribeTaskParamsSchema = z.object({ taskId: z.string() });

export const A2A_METHODS = {
  SendMessage: "SendMessage",
  SendStreamingMessage: "SendStreamingMessage",
  GetTask: "GetTask",
  ListTasks: "ListTasks",
  CancelTask: "CancelTask",
  SubscribeToTask: "SubscribeToTask",
} as const;
export type A2aMethod = (typeof A2A_METHODS)[keyof typeof A2A_METHODS];

/** 平台支持的六方法（push.* 全系 -32003） */
export function isSupportedA2aMethod(method: string): method is A2aMethod {
  return Object.values(A2A_METHODS).includes(method as A2aMethod);
}

// ── SSE 流帧（StreamResponse：task | statusUpdate | artifactUpdate 三态） ──

export const a2aStatusUpdateEventSchema = z.object({
  taskId: z.string(),
  contextId: z.string(),
  status: a2aTaskStatusSchema,
  final: z.boolean().default(false),
});

export const a2aArtifactUpdateEventSchema = z.object({
  taskId: z.string(),
  contextId: z.string(),
  artifact: a2aArtifactSchema,
});

// ── Agent Card ──

export const agentCardSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  version: z.string(),
  provider: z.object({ organization: z.string(), url: z.string().optional() }).optional(),
  iconUrl: z.string().optional(),
  documentationUrl: z.string().optional(),
  capabilities: z.object({
    streaming: z.boolean(),
    pushNotifications: z.boolean(),
    stateTransitionHistory: z.boolean().optional(),
  }),
  securitySchemes: z.record(
    z.string(),
    z.object({
      type: z.enum(["apiKey", "http", "oauth2", "oidc", "mtls"]),
      scheme: z.string().optional(),
      bearerFormat: z.string().optional(),
      name: z.string().optional(),
      in: z.enum(["header", "query", "cookie"]).optional(),
    }),
  ),
  security: z.array(z.record(z.string(), z.array(z.string()))),
  defaultInputModes: z.array(z.string()),
  defaultOutputModes: z.array(z.string()),
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      tags: z.array(z.string()).default([]),
    }),
  ),
  /** v1.0：supportedInterfaces（url/protocolBinding/protocolVersion） */
  supportedInterfaces: z.array(
    z.object({
      url: z.string(),
      protocolBinding: z.string(),
      protocolVersion: z.string(),
    }),
  ),
});
export type AgentCard = z.infer<typeof agentCardSchema>;
