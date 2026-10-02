/**
 * AGENT-001 PR-2：A2A v1.0.0 协议面（§2.5 方法表）——Agent Card + JSON-RPC 六方法 + SSE 流式。
 * 密钥鉴权（Bearer rag_*→SHA-256 比对）+ 10 QPS 限流；AgentRun 即 Task。
 */
import { randomUUID } from "node:crypto";
import {
  A2A_ERRORS,
  A2A_METHODS,
  A2A_PROTOCOL_VERSION,
  type A2aMessage,
  type A2aTaskState,
  type SendMessageParams,
  DomainError,
  ErrCode,
  isSupportedA2aMethod,
} from "@rabbit/shared";
import { prisma, runAsAdmin } from "@rabbit/db";
import { logFor } from "@rabbit/shared/logger";
import { redis } from "@/server/redis";
import { rateLimit } from "@/server/rate-limit";
import { hashAgentKey } from "./agent.service";
import { createRun, getRunRow } from "./run.service";

// ── 鉴权 ──

export interface A2aAuthResult {
  agentId: string;
  keyPrefix: string;
}

/** Bearer rag_ 密钥校验（SHA-256 比对；无效/吊销 → null） */
export async function authenticateA2aKey(
  projectId: string,
  agentId: string,
  bearer: string | null,
): Promise<A2aAuthResult | null> {
  if (!bearer?.startsWith("rag_")) return null;
  const agent = await prisma.projectAgent.findFirst({
    where: { id: agentId, projectId, deletedAt: null, a2aEnabled: true, enabled: true },
    select: { id: true, apiKeyHash: true, apiKeyPrefix: true },
  });
  if (!agent?.apiKeyHash) return null;
  const hash = hashAgentKey(bearer);
  if (hash !== agent.apiKeyHash) return null;
  // 更新 lastCalledAt（fire-and-forget）
  void prisma.projectAgent
    .update({ where: { id: agentId }, data: { lastCalledAt: new Date() } })
    .catch(() => {});
  return { agentId: agent.id, keyPrefix: agent.apiKeyPrefix ?? "" };
}

/** 10 QPS/密钥限流（复用 rateLimit 固定窗口） */
export async function checkA2aRateLimit(keyPrefix: string): Promise<boolean> {
  const key = `agent-a2a:rl:${keyPrefix}`;
  const count = await redis().incr(key);
  if (count === 1) await redis().expire(key, 1);
  return count <= 10;
}

// ── Agent Card（GET） ──

export async function buildAgentCard(projectId: string, agentId: string, origin: string) {
  const agent = await prisma.projectAgent.findFirst({
    where: { id: agentId, projectId, deletedAt: null, a2aEnabled: true, enabled: true },
    select: { id: true, name: true, description: true, mode: true, toolKeys: true },
  });
  if (!agent) return null;
  const rpcUrl = `${origin}/api/v1/a2a/projects/${projectId}/agents/${agentId}`;
  return {
    name: agent.name,
    description: agent.description ?? undefined,
    version: "1.0.0",
    capabilities: { streaming: true, pushNotifications: false },
    securitySchemes: { bearer: { type: "http" as const, scheme: "bearer" } },
    security: [{ bearer: [] }],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: `${agent.mode}-primary`,
        name: agent.mode === "pipeline" ? "测试资产生成" : "对话交互",
        description: agent.description ?? `${agent.name} 的 ${agent.mode} 模式能力`,
        tags: (agent.toolKeys as string[]) ?? [],
      },
    ],
    supportedInterfaces: [
      { url: rpcUrl, protocolBinding: "JSONRPC", protocolVersion: A2A_PROTOCOL_VERSION },
    ],
  };
}

// ── JSON-RPC 分发 ──

export interface A2aRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface A2aRpcResponse {
  jsonrpc: string;
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export async function handleA2aRpc(
  projectId: string,
  agentId: string,
  auth: A2aAuthResult,
  req: A2aRpcRequest,
  origin: string,
): Promise<A2aRpcResponse | { sse: boolean; stream: ReadableStream<Uint8Array> }> {
  const jsonId = req.id ?? null;
  const rpcError = (code: number, message: string): A2aRpcResponse => ({
    jsonrpc: "2.0",
    id: jsonId,
    error: { code, message },
  });

  // 版本协商
  const header = req as unknown as { __a2aVersion?: string };
  if (header.__a2aVersion && header.__a2aVersion.split(".")[0] !== A2A_PROTOCOL_VERSION.split(".")[0]) {
    return rpcError(A2A_ERRORS.VERSION_NOT_SUPPORTED, `Unsupported A2A-Version: ${header.__a2aVersion}`);
  }

  if (!isSupportedA2aMethod(req.method)) {
    if (req.method.startsWith("SetTaskPushNotificationConfig") || req.method.includes("PushNotification")) {
      return rpcError(A2A_ERRORS.PUSH_NOT_SUPPORTED, "Push notifications are not supported");
    }
    return rpcError(-32601, `Method not found: ${req.method}`);
  }

  try {
    return await runAsAdmin(async () => {
      switch (req.method) {
        case A2A_METHODS.SendMessage:
          return handleSendMessage(projectId, agentId, auth, req.params, false);
        case A2A_METHODS.SendStreamingMessage:
          return handleSendMessage(projectId, agentId, auth, req.params, true);
        case A2A_METHODS.GetTask:
          return handleGetTask(projectId, req.params);
        case A2A_METHODS.ListTasks:
          return handleListTasks(projectId, agentId, req.params);
        case A2A_METHODS.CancelTask:
          return handleCancelTask(projectId, req.params);
        case A2A_METHODS.SubscribeToTask:
          return handleSubscribeToTask(projectId, req.params);
        default:
          return rpcError(-32601, `Method not implemented: ${req.method}`);
      }
    });
  } catch (e) {
    if (e instanceof DomainError) {
      return rpcError(a2aErrorCode(e), e.message);
    }
    logFor("a2a").error({ err: (e as Error).message, agentId }, "a2a rpc error");
    return rpcError(-32603, "Internal error");
  }
}

function a2aErrorCode(e: DomainError): number {
  if (e.code === ErrCode.AGENT_RUN_NOT_FOUND) return A2A_ERRORS.TASK_NOT_FOUND;
  if (e.code === ErrCode.AGENT_RUN_NOT_CANCELLABLE) return A2A_ERRORS.TASK_NOT_CANCELABLE;
  if (e.code === ErrCode.AGENT_DISABLED) return A2A_ERRORS.UNSUPPORTED_OPERATION;
  return -32603;
}

// ── 方法实现 ──

async function handleSendMessage(
  projectId: string,
  agentId: string,
  auth: A2aAuthResult,
  params: unknown,
  streaming: boolean,
): Promise<A2aRpcResponse | { sse: boolean; stream: ReadableStream<Uint8Array> }> {
  const p = params as SendMessageParams | undefined;
  if (!p?.message?.parts?.length) {
    return { jsonrpc: "2.0", error: { code: -32602, message: "message.parts required" } };
  }
  const text = p.message.parts
    .filter((part) => "text" in part)
    .map((part) => (part as { text: string }).text)
    .join("\n");
  if (!text.trim()) {
    return { jsonrpc: "2.0", error: { code: A2A_ERRORS.CONTENT_TYPE_NOT_SUPPORTED, message: "TextPart required" } };
  }

  // A2A → 内部 Run（执行身份=runAsUser）
  const agent = await prisma.projectAgent.findFirst({
    where: { id: agentId, projectId, deletedAt: null },
    select: { runAsUserId: true, mode: true },
  });
  if (!agent) {
    return { jsonrpc: "2.0", error: { code: A2A_ERRORS.UNSUPPORTED_OPERATION, message: "Agent not found or disabled" } };
  }

  const run = await prisma.agentRun.create({
    data: {
      projectId,
      agentId,
      source: "A2A",
      contextId: randomUUID(),
      asUserId: agent.runAsUserId,
      status: "PENDING",
      input: { text, parts: JSON.parse(JSON.stringify(p.message.parts)) } as object,
      snapshot: { source: "a2a" },
      triggerUserId: null,
      a2aKeyPrefix: auth.keyPrefix,
    },
  });

  // 入队（延迟防竞态——同 AGENT-001 P1）
  setTimeout(() => {
    void (async () => {
      const { agentQueue } = await import("@/server/redis");
      await agentQueue()
        .add("chat", { runId: run.id }, { jobId: run.id, removeOnComplete: 500, removeOnFail: 500 })
        .catch(() => {});
    })();
  }, 200);

  if (streaming) {
    // SSE：首帧 Task(submitted) → statusUpdate → artifactUpdate → 终态关闭
    const stream = buildSseStream(run.id, run.contextId ?? "");
    return { sse: true, stream };
  }

  // 阻塞式：等待终态（上限 60s）
  const terminal = await waitForTerminal(projectId, run.id, 60_000);
  return { jsonrpc: "2.0", result: { task: terminal } };
}

function buildSseStream(runId: string, contextId: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send("message", { task: { id: runId, contextId, status: { state: "TASK_STATE_SUBMITTED" } } });
      // 轮询 Run 状态 → statusUpdate / artifactUpdate / 终态
      const deadline = Date.now() + 120_000;
      let lastStatus = "PENDING";
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const run = await prisma.agentRun
          .findUnique({ where: { id: runId }, select: { status: true, output: true, error: true } })
          .catch(() => null);
        if (!run) break;
        if (run.status !== lastStatus) {
          lastStatus = run.status;
          const a2aState = toA2aState(run.status);
          send("message", {
            statusUpdate: { taskId: runId, contextId, status: { state: a2aState }, final: isTerminal(run.status) },
          });
          if (isTerminal(run.status)) {
            if (run.output) {
              send("message", {
                artifactUpdate: {
                  taskId: runId,
                  contextId,
                  artifact: { parts: [{ text: JSON.stringify(run.output) }] },
                },
              });
            }
            break;
          }
        }
      }
      controller.close();
    },
  });
}

function toA2aState(status: string): A2aTaskState {
  switch (status) {
    case "PENDING": return "TASK_STATE_SUBMITTED";
    case "RUNNING": return "TASK_STATE_WORKING";
    case "COMPLETED": return "TASK_STATE_COMPLETED";
    case "FAILED": return "TASK_STATE_FAILED";
    case "CANCELED": return "TASK_STATE_CANCELED";
    default: return "TASK_STATE_REJECTED";
  }
}

function isTerminal(status: string): boolean {
  return ["COMPLETED", "FAILED", "CANCELED", "REJECTED"].includes(status);
}

async function waitForTerminal(projectId: string, runId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await prisma.agentRun
      .findUnique({ where: { id: runId }, select: { id: true, contextId: true, status: true, output: true, error: true } })
      .catch(() => null);
    if (run && isTerminal(run.status)) {
      return {
        id: run.id,
        contextId: run.contextId,
        status: { state: toA2aState(run.status), message: run.error ? { parts: [{ text: run.error }] } : undefined },
        artifacts: run.output ? [{ parts: [{ text: (run.output as { text?: string }).text ?? JSON.stringify(run.output) }] }] : [],
      };
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  // 超时：返回 WORKING 状态（客户端轮询 GetTask）
  return { id: runId, status: { state: "TASK_STATE_WORKING" as const } };
}

async function handleGetTask(projectId: string, params: unknown): Promise<A2aRpcResponse> {
  const p = params as { taskId?: string } | undefined;
  if (!p?.taskId) return { jsonrpc: "2.0", error: { code: -32602, message: "taskId required" } };
  const run = await prisma.agentRun.findFirst({
    where: { id: p.taskId, projectId },
    select: { id: true, contextId: true, status: true, output: true, error: true },
  });
  if (!run) return { jsonrpc: "2.0", error: { code: A2A_ERRORS.TASK_NOT_FOUND, message: "Task not found" } };
  return {
    jsonrpc: "2.0",
    result: {
      task: {
        id: run.id,
        contextId: run.contextId,
        status: { state: toA2aState(run.status) },
        artifacts: run.output ? [{ parts: [{ text: (run.output as { text?: string }).text ?? "" }] }] : [],
      },
    },
  };
}

async function handleListTasks(projectId: string, agentId: string, params: unknown): Promise<A2aRpcResponse> {
  const p = (params as { contextId?: string; pageSize?: number; pageToken?: string } | undefined) ?? {};
  const runs = await prisma.agentRun.findMany({
    where: { projectId, agentId, ...(p.contextId ? { contextId: p.contextId } : {}) },
    orderBy: { createdAt: "desc" },
    take: p.pageSize ?? 20,
    select: { id: true, contextId: true, status: true, createdAt: true },
  });
  return {
    jsonrpc: "2.0",
    result: {
      tasks: runs.map((r) => ({
        id: r.id,
        contextId: r.contextId,
        status: { state: toA2aState(r.status) },
      })),
    },
  };
}

async function handleCancelTask(projectId: string, params: unknown): Promise<A2aRpcResponse> {
  const p = params as { taskId?: string } | undefined;
  if (!p?.taskId) return { jsonrpc: "2.0", error: { code: -32602, message: "taskId required" } };
  const run = await prisma.agentRun.findFirst({
    where: { id: p.taskId, projectId },
    select: { id: true, status: true },
  });
  if (!run) return { jsonrpc: "2.0", error: { code: A2A_ERRORS.TASK_NOT_FOUND, message: "Task not found" } };
  if (!["PENDING", "RUNNING"].includes(run.status)) {
    return { jsonrpc: "2.0", error: { code: A2A_ERRORS.TASK_NOT_CANCELABLE, message: `Task is ${run.status}` } };
  }
  await redis().set(`agent-run:cancel:${run.id}`, "1", "EX", 3600);
  return { jsonrpc: "2.0", result: { task: { id: run.id, status: { state: "TASK_STATE_CANCELED" } } } };
}

async function handleSubscribeToTask(projectId: string, params: unknown): Promise<A2aRpcResponse | { sse: boolean; stream: ReadableStream<Uint8Array> }> {
  const p = params as { taskId?: string } | undefined;
  if (!p?.taskId) return { jsonrpc: "2.0", error: { code: -32602, message: "taskId required" } };
  const run = await prisma.agentRun.findFirst({
    where: { id: p.taskId, projectId },
    select: { id: true, contextId: true, status: true },
  });
  if (!run) return { jsonrpc: "2.0", error: { code: A2A_ERRORS.TASK_NOT_FOUND, message: "Task not found" } };
  if (isTerminal(run.status ?? "")) {
    return { jsonrpc: "2.0", error: { code: A2A_ERRORS.TASK_NOT_CANCELABLE, message: "Task already terminal" } };
  }
  const stream = buildSseStream(run.id, run.contextId ?? "");
  return { sse: true, stream };
}
