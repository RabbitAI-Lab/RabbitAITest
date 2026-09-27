/** AI-004 助手会话：个人级 CRUD + 上下文窗口 + SSE 流式对话（错误帧不落库）。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import type { z } from "zod";
import {
  AI_CHAT_CONTEXT_WINDOW,
  AI_SSE,
  AI_TITLE_MAX,
  ASSISTANT_SYSTEM_PROMPT,
  type AiSseFrame,
  aiChatSchema,
} from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { resolveRuntime } from "./model.service";
import { streamChat, type ChatMessage } from "./chat-client";

type ChatInput = z.infer<typeof aiChatSchema>;

export async function listConversations(userId: string) {
  const rows = await prisma.aiConversation.findMany({
    where: { userId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, modelId: true, createdAt: true, updatedAt: true },
  });
  return {
    total: rows.length,
    list: rows.map((r) => ({
      id: r.id,
      title: r.title,
      modelId: r.modelId,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

export async function createConversation(userId: string, input: { title?: string; modelId?: string | null }) {
  const c = await prisma.aiConversation.create({
    data: {
      userId,
      title: (input.title ?? "新对话").slice(0, 128),
      modelId: input.modelId ?? null,
    },
  });
  return { id: c.id, title: c.title };
}

async function ownedConversation(userId: string, id: string) {
  const c = await prisma.aiConversation.findFirst({ where: { id, userId, deletedAt: null } });
  if (!c) throw new DomainError(ErrCode.AI_CONVERSATION_NOT_FOUND, "会话不存在或无权访问");
  return c;
}

export async function renameConversation(userId: string, id: string, title: string) {
  await ownedConversation(userId, id);
  await prisma.aiConversation.update({ where: { id }, data: { title: title.slice(0, 128) } });
  return { id };
}

export async function deleteConversation(userId: string, id: string) {
  await ownedConversation(userId, id);
  await prisma.aiConversation.update({ where: { id }, data: { deletedAt: new Date() } });
  return { id };
}

export async function listMessages(userId: string, conversationId: string) {
  const c = await ownedConversation(userId, conversationId);
  const rows = await prisma.aiMessage.findMany({
    where: { conversationId: c.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return {
    total: rows.length,
    list: rows
      .reverse()
      .map((m) => ({ id: m.id, role: m.role, text: String((m.content as { text?: string })?.text ?? ""), createdAt: m.createdAt.toISOString() })),
  };
}

/** SSE 对话：落用户消息 → 最近 20 条上下文 → 流式转发 → 完成落助手消息。错误/中断半截不落库。 */
export async function chat(userId: string, input: ChatInput): Promise<Response> {
  const runtime = await resolveRuntime(input.modelId ?? null);
  let conversation = input.conversationId ? await ownedConversation(userId, input.conversationId) : null;
  if (!conversation) {
    conversation = await prisma.aiConversation.create({
      data: {
        userId,
        title: input.content.slice(0, AI_TITLE_MAX) || "新对话",
        modelId: runtime.id,
      },
    });
  } else {
    await prisma.aiConversation.update({ where: { id: conversation.id }, data: { modelId: runtime.id } });
  }
  const conversationId = conversation.id;
  const title = conversation.title;
  await prisma.aiMessage.create({
    data: { conversationId, role: "user", content: { text: input.content } },
  });
  const history = await prisma.aiMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: AI_CHAT_CONTEXT_WINDOW,
  });
  const messages: ChatMessage[] = [
    { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
    ...history
      .reverse()
      .map((m) => ({ role: m.role as ChatMessage["role"], content: String((m.content as { text?: string })?.text ?? "") })),
  ];

  const encoder = new TextEncoder();
  const abort = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (frame: AiSseFrame) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      let full = "";
      try {
        for await (const delta of streamChat(runtime, messages, { signal: abort.signal })) {
          full += delta;
          send({ type: AI_SSE.delta, text: delta });
        }
        const saved = await prisma.aiMessage.create({
          data: { conversationId, role: "assistant", content: { text: full } },
        });
        await prisma.aiConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
        send({ type: AI_SSE.done, messageId: saved.id, conversationId, title });
      } catch (err) {
        const code = err instanceof DomainError ? err.code : 50000;
        const message = err instanceof DomainError ? err.message : "服务内部错误";
        send({ type: AI_SSE.error, code, message });
      } finally {
        controller.close();
      }
    },
    cancel() {
      abort.abort(); // 客户端断开：级联取消上游，半截不落库
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
