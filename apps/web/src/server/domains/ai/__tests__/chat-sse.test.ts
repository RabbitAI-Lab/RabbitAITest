/** AI-004 §5 单测补齐：chat SSE 帧序列（delta*→done / error 不落库）——此前仅 e2e 断言帧 wire 格式，
 * event-stream body 读取是 Playwright 弱支撑（2026-09-28 AI 域并跑 flake 教训），帧级断言收归单测。 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AI_SSE, DomainError, ErrCode } from "@rabbit/shared";

vi.mock("@rabbit/db", () => {
  const state = {
    conversations: [] as { id: string; userId: string; title: string; deletedAt: Date | null }[],
    messages: [] as { id: string; role: string; content: unknown }[],
  };
  const prisma = {
    __state: state,
    aiConversation: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: { userId: string; title: string } }) => {
        const c = { id: `conv-${state.conversations.length + 1}`, userId: data.userId, title: data.title, deletedAt: null };
        state.conversations.push(c);
        return c;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ ...where, ...data })),
    },
    aiMessage: {
      create: vi.fn(async ({ data }: { data: { role: string; content: unknown } }) => {
        const m = { id: `msg-${state.messages.length + 1}`, ...data };
        state.messages.push(m);
        return m;
      }),
      // 服务端按 createdAt desc 取最近 20 条再 reverse——mock 按「新在前」返回
      findMany: vi.fn(async () => [...state.messages].reverse()),
    },
  };
  return { prisma };
});

vi.mock("../model.service", () => ({ resolveRuntimeForUser: vi.fn(async () => ({ id: "model-1" })) }));
vi.mock("../chat-client", () => ({ streamChat: vi.fn() }));

import { prisma } from "@rabbit/db";
import { chat } from "../chat.service";
import { streamChat } from "../chat-client";

const state = (prisma as unknown as { __state: { conversations: unknown[]; messages: { id: string; role: string; content: unknown }[] } }).__state;

async function readFrames(res: Response) {
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const body = await res.text();
  return body
    .trim()
    .split("\n\n")
    .map((line) => JSON.parse(line.replace(/^data: /, "")) as { type: string; text?: string; code?: number; message?: string; messageId?: string; conversationId?: string; title?: string });
}

beforeEach(() => {
  state.conversations.length = 0;
  state.messages.length = 0;
  vi.mocked(streamChat).mockReset();
});

describe("AI-004 chat SSE 帧序列", () => {
  it("delta*→done：分片顺序下发，done 携带 messageId/conversationId/title（=首条消息前 20 字）", async () => {
    vi.mocked(streamChat).mockImplementation(async function* () {
      yield "你";
      yield "好";
      yield "！";
    });
    const long = "密码锁定策略怎么设计用例".repeat(3); // 33 字 → 标题截 20
    const res = await chat("u1", { content: long });

    const frames = await readFrames(res);
    expect(frames.map((f) => f.type)).toEqual([AI_SSE.delta, AI_SSE.delta, AI_SSE.delta, AI_SSE.done]);
    expect(frames.slice(0, 3).map((f) => f.text)).toEqual(["你", "好", "！"]);
    const done = frames[3]!;
    expect(done.conversationId).toBe("conv-1");
    expect(done.messageId).toBe("msg-2");
    expect(done.title).toHaveLength(20);

    // 落库：用户消息（全文不截断）+ 助手完整聚合文本
    expect(state.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(state.messages[0]!.content).toEqual({ text: long });
    expect(state.messages[1]!.content).toEqual({ text: "你好！" });
  });

  it("上游失败 → error 帧且助手半截不落库", async () => {
    vi.mocked(streamChat).mockImplementation(async function* () {
      yield "半截";
      throw new DomainError(ErrCode.AI_PROVIDER_ERROR, "上游不可用");
    });
    const res = await chat("u1", { content: "hi" });

    const frames = await readFrames(res);
    // 半截 delta 已下发（流式不可撤回），随后 error 帧兜底、无 done 帧
    const last = frames[frames.length - 1]!;
    expect(last.type).toBe(AI_SSE.error);
    expect(last.code).toBe(70501);
    expect(last.message).toContain("上游不可用");
    expect(frames.some((f) => f.type === AI_SSE.done)).toBe(false);

    // 仅用户消息落库；assistant 完整文本从未写入
    expect(state.messages.map((m) => m.role)).toEqual(["user"]);
  });
});
