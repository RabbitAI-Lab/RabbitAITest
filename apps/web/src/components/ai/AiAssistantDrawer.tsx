"use client";

import { Button, Drawer, Input, Select } from "antd";
import { Bubble, Conversations, Prompts, Sender, Welcome } from "@ant-design/x";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
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

type BubbleItem = NonNullable<React.ComponentProps<typeof Bubble.List>["items"]>[number];
type BubbleRoles = React.ComponentProps<typeof Bubble.List>["roles"];

/** 空态能力建议卡（AI-004 §3 UI v2：Welcome + Prompts，点击即填入输入框） */
const PROMPT_ITEMS = [
  { key: "case-design", label: "用例设计思路", description: "「帮我设计登录功能的测试用例」" },
  { key: "troubleshoot", label: "接口故障排查", description: "「批量执行 502 的排查思路」" },
  { key: "doc-interpret", label: "测试文档解读", description: "「解读这段 OpenAPI 定义的风险点」" },
];

/**
 * AI-004 AI 智能助手（UI v2，Ant Design X）：
 * Conversations 会话栏 + Bubble.List 气泡流 + Sender 输入区；SSE 消费逻辑与 v1 一致。
 * testid 契约见规格 §9（ai-chat-send/stop 挂 Sender 自定义动作条的 SendButton/LoadingButton；textarea 经 components.input 挂 ai-chat-input）。
 */
export function AiAssistantDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [modelId, setModelId] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const conversations = useQuery({
    queryKey: ["ai-conversations"],
    queryFn: listAiConversations,
    enabled: open,
  });
  const models = useQuery({
    queryKey: ["ai-model-picker"],
    queryFn: listEnabledAiModels,
    enabled: open,
  });
  const history = useQuery({
    queryKey: ["ai-messages", activeId],
    queryFn: () => listAiMessages(activeId!),
    enabled: open && !!activeId,
  });

  useEffect(() => {
    if (!history.data) return;
    setMessages(
      history.data.list.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        text: m.text,
      })),
    );
  }, [history.data]);

  const newConversation = async () => {
    const c = await createAiConversation();
    setActiveId(c.id);
    setMessages([]);
    void qc.invalidateQueries({ queryKey: ["ai-conversations"] });
  };

  const send = (content: string) => {
    if (!content.trim() || sending) return;
    setInput("");
    setSending(true);
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", text: content },
      { id: `a-${Date.now()}`, role: "assistant", text: "", streaming: true },
    ]);
    const abort = new AbortController();
    abortRef.current = abort;
    let assistantId = `a-${Date.now()}`;
    void streamAiChat(
      { conversationId: activeId ?? undefined, content, modelId },
      (frame) => {
        if (frame.type === "delta") {
          setMessages((prev) =>
            prev.map((m) => (m.streaming ? { ...m, text: m.text + frame.text } : m)),
          );
        } else if (frame.type === "done") {
          assistantId = frame.messageId;
          setMessages((prev) =>
            prev.map((m) => (m.streaming ? { ...m, id: assistantId, streaming: false } : m)),
          );
          if (!activeId) setActiveId(frame.conversationId);
          void qc.invalidateQueries({ queryKey: ["ai-conversations"] });
        } else if (frame.type === "error") {
          // 错误帧：助手消息标记错误（半截不落库，服务端未保存）
          setMessages((prev) =>
            prev
              .filter((m) => !m.streaming)
              .concat([
                {
                  id: assistantId,
                  role: "assistant",
                  text: "",
                  error: `✗ ${frame.message}（${frame.code}）——本条未保存，可重试`,
                },
              ]),
          );
        }
      },
      abort.signal,
    )
      .catch(() => {
        setMessages((prev) => prev.filter((m) => !m.streaming || m.text === ""));
      })
      .finally(() => {
        setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
        setSending(false);
        abortRef.current = null;
      });
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

  const roles: BubbleRoles = {
    user: {
      placement: "end",
      variant: "filled",
      avatar: { style: { background: "#E5E6EB", color: "#646A73" }, children: "我" },
      styles: {
        content: {
          background: "linear-gradient(135deg, #574BFF, #7A5CFF)",
          color: "#fff",
          borderRadius: 16,
          borderBottomRightRadius: 4,
          whiteSpace: "pre-wrap",
        },
      },
    },
    assistant: {
      placement: "start",
      variant: "outlined",
      avatar: { style: { background: "linear-gradient(135deg, #574BFF, #9D8BFF)" }, children: "✦" },
      styles: { content: { borderRadius: 16, borderBottomLeftRadius: 4, whiteSpace: "pre-wrap" } },
    },
  };

  const bubbleItems: BubbleItem[] = messages.map((m) =>
    m.error
      ? {
          key: m.id,
          role: "assistant",
          content: m.error,
          variant: "borderless",
          messageRender: () => (
            <div
              className="border border-red-200 bg-red-50 rounded-2xl rounded-bl-md px-4 py-2.5 text-xs text-red-500 max-w-[85%]"
              data-testid="ai-chat-error"
            >
              {m.error}
            </div>
          ),
        }
      : {
          key: m.id,
          role: m.role,
          content: m.text,
          messageRender: m.streaming
            ? (c) => (
                <>
                  {c}
                  <span className="inline-block w-0.5 h-4 bg-[#574BFF] align-middle animate-pulse ml-1" />
                </>
              )
            : undefined,
        },
  );

  const convItems = (conversations.data?.list ?? []).map((c: AiConversationRow) => ({
    key: c.id,
    label: <span title="菜单中可重命名/删除">{c.title}</span>,
  }));

  return (
    <Drawer
      title={
        <span className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-gradient-to-br from-[#574BFF] to-[#9D8BFF] grid place-items-center text-white text-[10px]">
            ✦
          </span>
          AI 助手
          <span className="text-[11px] font-normal text-slate-400">个人级会话 · 流式输出</span>
        </span>
      }
      placement="right"
      width={720}
      open={open}
      onClose={onClose}
      styles={{ body: { padding: 0 } }}
      data-testid="ai-assistant-drawer"
    >
      <div className="flex h-full">
        <aside
          className="w-56 border-r p-2.5 flex flex-col gap-2 bg-[#FAFAFB]"
          data-testid="ai-conversation-list"
        >
          <Button
            block
            icon={<PlusOutlined />}
            onClick={newConversation}
            data-testid="ai-new-conversation"
          >
            新对话
          </Button>
          <p className="px-1.5 text-[11px] text-slate-400">历史会话（个人级）</p>
          <Conversations
            className="flex-1 min-h-0 overflow-y-auto"
            items={convItems}
            activeKey={activeId ?? undefined}
            onActiveChange={setActiveId}
            menu={(conv) => ({
              items: [
                { key: "rename", icon: <EditOutlined />, label: "重命名" },
                { key: "delete", icon: <DeleteOutlined />, label: "删除", danger: true },
              ],
              onClick: ({ key }) => {
                if (key === "rename") {
                  const current = typeof conv.label === "string" ? conv.label : cTitle(conv);
                  const next = window.prompt("重命名会话", current);
                  if (next) void rename(conv.key, next);
                } else {
                  void removeConversation(conv.key);
                }
              },
            })}
          />
          <p className="px-1.5 text-[10px] text-slate-300">软删 30 天清理 · 仅本人可见</p>
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-0" data-testid="ai-chat-messages">
            {messages.length === 0 ? (
              <div className="h-full overflow-y-auto flex flex-col items-center justify-center gap-5 px-8 py-6">
                <Welcome
                  icon={
                    <span className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#574BFF] to-[#9D8BFF] grid place-items-center text-white text-2xl shadow-md">
                      ✦
                    </span>
                  }
                  title="我是 RabbitAITest 智能助手"
                  description="会话为个人级 · 模型可在输入区切换"
                />
                <Prompts
                  className="w-full max-w-sm"
                  vertical
                  items={PROMPT_ITEMS}
                  onItemClick={({ data }) =>
                    setInput(String(data.description ?? "").replace(/[「」]/g, ""))
                  }
                />
              </div>
            ) : (
              <Bubble.List
                className="h-full px-4 py-4"
                autoScroll
                roles={roles}
                items={bubbleItems}
              />
            )}
          </div>

          <div className="p-4 pt-2">
            <Sender
              value={input}
              onChange={setInput}
              onSubmit={send}
              loading={sending}
              onCancel={() => abortRef.current?.abort()}
              placeholder="输入问题…（Enter 发送 / Shift+Enter 换行）"
              components={{
                input: (p) => (
                  <Input.TextArea {...p} variant="borderless" data-testid="ai-chat-input" />
                ),
              }}
              actions={(_, { components: { SendButton, LoadingButton } }) => (
                <div className="flex items-center gap-2 w-full">
                  <Select
                    size="small"
                    className="w-44"
                    placeholder={(models.data?.total ?? 0) === 0 ? "未配置模型" : "默认模型"}
                    value={modelId}
                    onChange={setModelId}
                    options={(models.data?.list ?? []).map((m) => ({
                      value: m.id,
                      label: `${m.isDefault ? "★ " : ""}${m.model}`,
                    }))}
                    data-testid="ai-chat-model-select"
                  />
                  <span className="text-[10px] text-slate-300">上下文取最近 20 条</span>
                  {sending ? (
                    <LoadingButton data-testid="ai-chat-stop" />
                  ) : (
                    <SendButton data-testid="ai-chat-send" />
                  )}
                </div>
              )}
            />
          </div>
        </div>
      </div>
    </Drawer>
  );
}

/** 会话项 label 为 JSX 时取回纯文本（重命名 prompt 默认值） */
function cTitle(conv: { label?: unknown }): string {
  const node = conv.label as { props?: { children?: string } } | string | undefined;
  if (typeof node === "string") return node;
  return node?.props?.children ?? "";
}
