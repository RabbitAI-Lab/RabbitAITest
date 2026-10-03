"use client";

import { Alert, Button, Input, Spin, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { agentApi, agentRunStreamUrl } from "@rabbit/api-client";
import { useApp } from "@/hooks/useApp";

import { useProjectStore } from "@/stores/project";

interface TraceItem {
  kind: "user" | "assistant" | "tool" | "ws" | "final" | "error";
  label: string;
  detail?: unknown;
}

/** AGENT-001 调试台：左对话（最终答复）+ 右轨迹（ws 步/工具入出参/SSE 帧实时）。 */
export default function AgentDebugPage() {
  const { message } = useApp();
  const router = useRouter();
  const params = useParams<{ agentId: string }>();
  const agentId = params.agentId;
  const { currentProjectId: projectId } = useProjectStore();
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceItem[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const agent = useQuery({
    queryKey: ["agent", projectId, agentId],
    queryFn: () => agentApi.get(projectId!, agentId),
    enabled: Boolean(projectId && agentId),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [trace]);

  useEffect(() => () => esRef.current?.close(), []);

  const subscribe = (runId: string) => {
    esRef.current?.close();
    const es = new EventSource(agentRunStreamUrl(runId));
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data) as { type: string; payload?: Record<string, unknown> };
        const p = frame.payload ?? {};
        if (frame.type === "ws-step") {
          setTrace((t) => [...t, { kind: "ws", label: `📁 ${String(p.detail ?? "")}`, detail: p }]);
        } else if (frame.type === "tool-result") {
          setTrace((t) => [
            ...t,
            {
              kind: "tool",
              label: `🔧 ${String(p.key)} ${p.ok ? `✓ ${String(p.ms ?? "")}ms` : "✗"}`,
              detail: p.output,
            },
          ]);
        } else if (frame.type === "final") {
          setTrace((t) => [
            ...t,
            {
              kind: p.status === "COMPLETED" ? "assistant" : "error",
              label:
                p.status === "COMPLETED"
                  ? String(p.text ?? "（完成）")
                  : `运行结束：${String(p.status)} ${String(p.error ?? "")}`,
            },
          ]);
          setRunning(false);
          es.close();
        }
      } catch {
        /* 忽略坏帧 */
      }
    };
    es.onerror = () => {
      setRunning(false);
      es.close();
    };
  };

  const send = async () => {
    if (!input.trim() || !projectId) return;
    const text = input.trim();
    setInput("");
    setTrace((t) => [...t, { kind: "user", label: text }]);
    setRunning(true);
    try {
      const r = await agentApi.run(projectId, agentId, { message: text });
      setLastRunId(r.runId);
      subscribe(r.runId);
    } catch (e) {
      setTrace((t) => [...t, { kind: "error", label: `发起失败：${(e as Error).message}` }]);
      setRunning(false);
    }
  };

  const cancel = async () => {
    if (lastRunId && projectId) {
      await agentApi.cancelRun(projectId, lastRunId).catch((e: Error) => message.error(e.message));
    }
  };

  return (
    <div className="flex h-full flex-col" data-testid="agent-debug-page">
      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-6 py-3">
        <Button
          size="small"
          onClick={() => router.push("/agents")}
          data-testid="agent-debug-back"
        >
          返回
        </Button>
        <Typography.Text strong>{agent.data?.name ?? "Agent"} · 调试台</Typography.Text>
        <Tag color={agent.data?.mode === "pipeline" ? "green" : "blue"}>
          {agent.data?.mode ?? "chat"}
        </Tag>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          执行身份：当前登录用户 · 工作目录 tasks/{"{runId}"}（repos/platform-docs 只读软链）
        </Typography.Text>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col bg-gray-50">
          <div className="flex-1 space-y-3 overflow-auto p-6">
            {!trace.length && (
              <Alert
                type="info"
                showIcon
                message="输入消息发起一次运行"
                description="运行过程：工作目录准备（clone/切分支/文档同步）→ pi 会话（可读工作区、调平台工具）→ 最终答复。右侧实时显示轨迹。"
              />
            )}
            {trace.map((t, i) => (
              <div key={i} className={t.kind === "user" ? "flex justify-end" : "flex gap-2"}>
                {t.kind === "user" ? (
                  <div className="max-w-[75%] rounded-xl bg-indigo-600 px-4 py-2.5 text-white">
                    {t.label}
                  </div>
                ) : t.kind === "assistant" ? (
                  <div className="max-w-[80%] whitespace-pre-wrap rounded-xl border border-gray-200 bg-white px-4 py-2.5">
                    {t.label}
                  </div>
                ) : t.kind === "error" ? (
                  <Alert type="error" showIcon message={t.label} className="max-w-[80%]" />
                ) : (
                  <div className="max-w-[80%] rounded border border-gray-100 bg-white px-3 py-1.5 text-xs text-gray-500">
                    {t.label}
                  </div>
                )}
              </div>
            ))}
            {running && (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Spin size="small" /> 运行中…
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <div className="flex items-center gap-2 border-t border-gray-200 bg-white p-4">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={send}
              placeholder="输入消息，Enter 发送"
              disabled={running}
              data-testid="agent-debug-input"
            />
            <Button type="primary" onClick={send} loading={running} data-testid="agent-debug-send">
              发送
            </Button>
          </div>
        </div>
        <div className="w-80 shrink-0 overflow-auto border-l border-gray-200 bg-white p-4">
          <Typography.Text strong>运行轨迹</Typography.Text>
          <div className="mt-3 space-y-2">
            {trace
              .filter((t) => t.kind === "ws" || t.kind === "tool")
              .map((t, i) => (
                <div key={i} className="rounded border border-gray-100 px-2 py-1.5 text-xs">
                  <div className="text-gray-700">{t.label}</div>
                  {t.detail != null && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-indigo-600">入参/出参</summary>
                      <pre className="mt-1 max-h-48 overflow-auto text-[10px] text-gray-500">
                        {JSON.stringify(t.detail, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            {!trace.some((t) => t.kind === "ws" || t.kind === "tool") && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                工作目录准备与工具调用步骤将实时出现在这里
              </Typography.Text>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
