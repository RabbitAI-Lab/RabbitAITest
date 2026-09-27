"use client";

import { Button, Drawer, Input, Popconfirm, Select } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  createAiConversation,
  deleteAiConversation,
  listAiConversations,
  listAiMessages,
  listEnabledAiModels,
  renameAiConversation,
  streamAiChat,
  type AiConversationRow,
} from "@rabbit/api-client";

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  error?: string;
}

/** AI-004 AI 智能助手：会话列表 + SSE 打字机 + 会话管理（个人级）。 */
export function AiAssistantDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [modelId, setModelId] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const conversations = useQuery({
    queryKey: ["ai-conversations"],
    queryFn: listAiConversations,
    enabled: open,
  });
  const models = useQuery({ queryKey: ["ai-model-picker"], queryFn: listEnabledAiModels, enabled: open });
  const history = useQuery({
    queryKey: ["ai-messages", activeId],
    queryFn: () => listAiMessages(activeId!),
    enabled: open && !!activeId,
  });

  useEffect(() => {
    if (!history.data) return;
    setMessages(
      history.data.list.map((m) => ({ id: m.id, role: m.role as "user" | "assistant", text: m.text })),
    );
  }, [history.data]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const newConversation = async () => {
    const c = await createAiConversation();
    setActiveId(c.id);
    setMessages([]);
    void qc.invalidateQueries({ queryKey: ["ai-conversations"] });
  };

  const send = async () => {
    const content = input.trim();
    if (!content || sending) return;
    setInput("");
    setSending(true);
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: content }, { id: `a-${Date.now()}`, role: "assistant", text: "", streaming: true }]);
    const abort = new AbortController();
    abortRef.current = abort;
    let assistantId = `a-${Date.now()}`;
    try {
      await streamAiChat(
        { conversationId: activeId ?? undefined, content, modelId },
        (frame) => {
          if (frame.type === "delta") {
            setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, text: m.text + frame.text } : m)));
          } else if (frame.type === "done") {
            assistantId = frame.messageId;
            setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, id: assistantId, streaming: false } : m)));
            if (!activeId) setActiveId(frame.conversationId);
            void qc.invalidateQueries({ queryKey: ["ai-conversations"] });
          } else if (frame.type === "error") {
            // 错误帧：助手消息标记错误（半截不落库，服务端未保存）
            setMessages((prev) => prev.filter((m) => !m.streaming).concat([{ id: assistantId, role: "assistant", text: "", error: `✗ ${frame.message}（${frame.code}）——本条未保存，可重试` }]));
          }
        },
        abort.signal,
      );
    } catch {
      setMessages((prev) => prev.filter((m) => !m.streaming || m.text === ""));
    } finally {
      setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
      setSending(false);
      abortRef.current = null;
    }
  };

  const removeConversation = async (id: string) => {
    await deleteAiConversation(id);
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
    void qc.invalidateQueries({ queryKey: ["ai-conversations"] });
  };

  const rename = async (id: string, title: string) => {
    await renameAiConversation(id, title);
    void qc.invalidateQueries({ queryKey: ["ai-conversations"] });
  };

  return (
    <Drawer
      title={<span className="flex items-center gap-1.5">✦ AI 助手</span>}
      placement="right"
      width={560}
      open={open}
      onClose={onClose}
      styles={{ body: { padding: 0 } }}
      data-testid="ai-assistant-drawer"
    >
      <div className="flex h-full">
        <div className="w-48 border-r p-2 space-y-1 overflow-y-auto" data-testid="ai-conversation-list">
          <Button block size="small" type="primary" ghost onClick={newConversation} data-testid="ai-new-conversation">
            ＋ 新对话
          </Button>
          <p className="px-2 py-1 text-slate-400 text-[11px]">历史会话（个人级）</p>
          {(conversations.data?.list ?? []).map((c: AiConversationRow) => (
            <div
              key={c.id}
              className={`group flex items-center rounded px-2 py-1.5 text-xs cursor-pointer truncate ${activeId === c.id ? "bg-[#574BFF]/10 text-[#574BFF]" : "hover:bg-slate-100 text-slate-600"}`}
              onClick={() => setActiveId(c.id)}
              data-testid={`ai-conversation-${c.title}`}
            >
              <span
                className="truncate flex-1"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const next = window.prompt("重命名会话", c.title);
                  if (next) void rename(c.id, next);
                }}
                title="双击重命名"
              >
                {c.title}
              </span>
              <Popconfirm title="删除该会话？" onConfirm={(e) => { e?.stopPropagation(); void removeConversation(c.id); }}>
                <span className="hidden group-hover:inline text-red-400 ml-1" onClick={(e) => e.stopPropagation()}>
                  ×
                </span>
              </Popconfirm>
            </div>
          ))}
        </div>
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 p-4 space-y-3 overflow-y-auto" data-testid="ai-chat-messages">
            {messages.length === 0 ? (
              <div className="h-full grid place-items-center text-center">
                <div className="space-y-2">
                  <p className="text-2xl">✦</p>
                  <p className="font-medium text-sm">我是 RabbitAITest 智能助手</p>
                  <p className="text-xs text-slate-400">可以帮你：梳理用例设计思路 · 接口故障排查 · 解读测试文档</p>
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.error ? (
                    <div className="border border-red-200 bg-red-50 rounded-xl px-3 py-2 text-xs text-red-500 max-w-[80%]" data-testid="ai-chat-error">
                      {m.error}
                    </div>
                  ) : (
                    <div
                      className={`rounded-xl px-3 py-2 text-[13px] max-w-[80%] whitespace-pre-wrap break-words ${
                        m.role === "user" ? "bg-[#574BFF] text-white rounded-br-sm" : "border bg-white rounded-bl-sm"
                      }`}
                    >
                      {m.text}
                      {m.streaming && <span className="inline-block w-0.5 h-4 bg-[#574BFF] align-middle animate-pulse ml-0.5" />}
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
          <div className="border-t p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-xs">模型</span>
              <Select
                size="small"
                className="w-48"
                placeholder={(models.data?.total ?? 0) === 0 ? "未配置模型" : "默认模型"}
                value={modelId}
                onChange={setModelId}
                options={(models.data?.list ?? []).map((m) => ({ value: m.id, label: `${m.isDefault ? "★ " : ""}${m.model}` }))}
                data-testid="ai-chat-model-select"
              />
            </div>
            <div className="flex gap-2">
              <Input.TextArea
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="输入问题…（Enter 发送 / Shift+Enter 换行）"
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                data-testid="ai-chat-input"
              />
              <div className="flex flex-col gap-1">
                {sending ? (
                  <Button size="small" danger onClick={() => abortRef.current?.abort()} data-testid="ai-chat-stop">
                    ■ 停止
                  </Button>
                ) : (
                  <Button type="primary" size="small" onClick={send} disabled={!input.trim()} data-testid="ai-chat-send">
                    发送
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
