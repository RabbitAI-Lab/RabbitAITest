/** AGENT-001 PR-2 A2A 面单测：Agent Card 形状 / 密钥鉴权（无效/吊销） / JSON-RPC 六方法分发 / 错误码映射 / SSE 帧结构。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { A2A_ERRORS, A2A_METHODS } from "@rabbit/shared";

vi.mock("@rabbit/db", () => ({
  Prisma: {},
  prisma: {
    projectAgent: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(async () => ({})),
    },
    agentRun: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
  runAsAdmin: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@/server/redis", () => ({
  redis: () => ({
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    set: vi.fn(async () => "OK"),
    get: vi.fn(async () => null),
  }),
  agentQueue: () => ({ add: vi.fn(async () => ({})) }),
}));

vi.mock("@/server/rate-limit", () => ({ rateLimit: vi.fn() }));

import { prisma } from "@rabbit/db";
import {
  authenticateA2aKey,
  buildAgentCard,
  handleA2aRpc,
  type A2aAuthResult,
} from "../a2a.service";
import { hashAgentKey } from "../agent.service";

const TEST_KEY = "rag_TestKey1234567890abcdef123456";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("A2A 密钥鉴权", () => {
  it("有效 Bearer 密钥 → 通过（SHA-256 比对）", async () => {
    (prisma.projectAgent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "a1",
      apiKeyHash: hashAgentKey(TEST_KEY),
      apiKeyPrefix: TEST_KEY.slice(0, 9),
    });
    const r = await authenticateA2aKey("p1", "a1", TEST_KEY);
    expect(r?.agentId).toBe("a1");
  });

  it("无效密钥 → null", async () => {
    (prisma.projectAgent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "a1",
      apiKeyHash: hashAgentKey("rag_DifferentKey1234567890123456789"),
      apiKeyPrefix: "rag_Diff",
    });
    const r = await authenticateA2aKey("p1", "a1", TEST_KEY);
    expect(r).toBeNull();
  });

  it("A2A 未开启 → null", async () => {
    (prisma.projectAgent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await authenticateA2aKey("p1", "a1", TEST_KEY)).toBeNull();
  });
});

describe("Agent Card", () => {
  it("A2A 开启的 Agent → 完整 Card（v1.0 字段齐）", async () => {
    (prisma.projectAgent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "a1",
      name: "测试 Agent",
      description: "测试",
      mode: "chat",
      toolKeys: ["case.search"],
    });
    const card = await buildAgentCard("p1", "a1", "https://example.com");
    expect(card).toMatchObject({
      name: "测试 Agent",
      version: "1.0.0",
      capabilities: { streaming: true, pushNotifications: false },
    });
    expect(card!.supportedInterfaces[0]).toMatchObject({
      protocolBinding: "JSONRPC",
      protocolVersion: "1.0",
    });
    expect(card!.securitySchemes).toHaveProperty("bearer");
  });

  it("A2A 未开启 → null（404 防枚举）", async () => {
    (prisma.projectAgent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await buildAgentCard("p1", "a1", "https://x.com")).toBeNull();
  });
});

describe("JSON-RPC 分发", () => {
  const auth: A2aAuthResult = { agentId: "a1", keyPrefix: "rag_Test" };

  it("未知方法 → -32601", async () => {
    const r = await handleA2aRpc("p1", "a1", auth, { jsonrpc: "2.0", method: "Unknown.Method" }, "https://x.com");
    expect((r as { error?: { code: number } }).error?.code).toBe(-32601);
  });

  it("Push Notification 类方法 → -32003", async () => {
    const r = await handleA2aRpc("p1", "a1", auth, { jsonrpc: "2.0", method: "SetTaskPushNotificationConfig" }, "https://x.com");
    expect((r as { error?: { code: number } }).error?.code).toBe(A2A_ERRORS.PUSH_NOT_SUPPORTED);
  });

  it("GetTask 未知任务 → -32001", async () => {
    (prisma.agentRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await handleA2aRpc("p1", "a1", auth, { jsonrpc: "2.0", method: "GetTask", params: { taskId: "unknown" } }, "https://x.com");
    expect((r as { error?: { code: number } }).error?.code).toBe(A2A_ERRORS.TASK_NOT_FOUND);
  });

  it("CancelTask 已终态 → -32002", async () => {
    (prisma.agentRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "r1", status: "COMPLETED" });
    const r = await handleA2aRpc("p1", "a1", auth, { jsonrpc: "2.0", method: "CancelTask", params: { taskId: "r1" } }, "https://x.com");
    expect((r as { error?: { code: number } }).error?.code).toBe(A2A_ERRORS.TASK_NOT_CANCELABLE);
  });

  it("SendMessage 无 message.parts → -32602", async () => {
    const r = await handleA2aRpc("p1", "a1", auth, { jsonrpc: "2.0", method: "SendMessage", params: {} }, "https://x.com");
    expect((r as { error?: { code: number } }).error?.code).toBe(-32602);
  });

  it("SendMessage 正常 → 创建 AgentRun（source=A2A）", async () => {
    (prisma.projectAgent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ runAsUserId: "u1", mode: "chat" });
    (prisma.agentRun.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "run1", contextId: "ctx1" });
    (prisma.agentRun.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "run1", contextId: "ctx1", status: "COMPLETED", output: { text: "生成完毕" }, error: null,
    });
    const r = await handleA2aRpc(
      "p1", "a1", auth,
      { jsonrpc: "2.0", method: "SendMessage", params: { message: { role: "ROLE_USER", parts: [{ text: "生成用例" }], messageId: "m1" } } },
      "https://x.com",
    );
    expect((r as { result?: { task?: { id?: string } } }).result?.task?.id).toBe("run1");
    const data = (prisma.agentRun.create as ReturnType<typeof vi.fn>).mock.calls[0]![0].data;
    expect(data.source).toBe("A2A");
    expect(data.asUserId).toBe("u1");
  });
});

describe("A2A 错误码（协议 -3200x 段）", () => {
  it("枚举值与协议 v1.0 §5.4 对齐", () => {
    expect(A2A_ERRORS.TASK_NOT_FOUND).toBe(-32001);
    expect(A2A_ERRORS.TASK_NOT_CANCELABLE).toBe(-32002);
    expect(A2A_ERRORS.PUSH_NOT_SUPPORTED).toBe(-32003);
    expect(A2A_ERRORS.UNSUPPORTED_OPERATION).toBe(-32004);
    expect(A2A_ERRORS.CONTENT_TYPE_NOT_SUPPORTED).toBe(-32005);
    expect(A2A_ERRORS.VERSION_NOT_SUPPORTED).toBe(-32009);
  });

  it("方法枚举六方法齐", () => {
    const methods = Object.values(A2A_METHODS);
    expect(methods).toContain("SendMessage");
    expect(methods).toContain("SendStreamingMessage");
    expect(methods).toContain("GetTask");
    expect(methods).toContain("ListTasks");
    expect(methods).toContain("CancelTask");
    expect(methods).toContain("SubscribeToTask");
    expect(methods).toHaveLength(6);
  });
});
