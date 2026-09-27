/** OpenAI 兼容 ChatClient（AI-001 §2）：DeepSeek/OpenAI/智谱三供应商协议同构，统一 chat/completions。
 * 非流式返回全文；流式返回 AsyncGenerator<string>（SSE data: 行解析，[DONE] 终止）。 */
import { DomainError, ErrCode } from "@rabbit/shared";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiModelRuntime {
  id: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

const TIMEOUT_MS = 60_000;

function endpoint(m: AiModelRuntime): string {
  return `${m.baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

function providerError(status: number, bodyText: string): DomainError {
  const excerpt = bodyText.slice(0, 200).replace(/sk-[A-Za-z0-9_-]+/g, "sk-****");
  console.error(`[ai-gateway] upstream ${status}: ${excerpt || "（无响应体）"}`); // 排障日志（无 key）
  return new DomainError(ErrCode.AI_PROVIDER_ERROR, `供应商返回 ${status}：${excerpt || "（无响应体）"}`);
}

export async function callChat(
  m: AiModelRuntime,
  messages: ChatMessage[],
  opts: { stream?: boolean; signal?: AbortSignal; maxTokens?: number } = {},
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(endpoint(m), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${m.apiKey}` },
      body: JSON.stringify({
        model: m.model,
        messages,
        stream: false,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
      signal: opts.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError(ErrCode.AI_PROVIDER_ERROR, `供应商连接失败：${(e as Error).message}`);
  }
  const bodyText = await res.text();
  if (!res.ok) throw providerError(res.status, bodyText);
  try {
    const data = JSON.parse(bodyText) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  } catch {
    throw new DomainError(ErrCode.AI_PROVIDER_ERROR, "供应商响应体无法解析");
  }
}

/** 流式调用：逐 delta 产出文本片段；调用方取消 signal 时上游连接一并中止。 */
export async function* streamChat(
  m: AiModelRuntime,
  messages: ChatMessage[],
  opts: { signal?: AbortSignal } = {},
): AsyncGenerator<string> {
  let res: Response;
  try {
    res = await fetch(endpoint(m), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${m.apiKey}` },
      body: JSON.stringify({ model: m.model, messages, stream: true }),
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError(ErrCode.AI_PROVIDER_ERROR, `供应商连接失败：${(e as Error).message}`);
  }
  if (!res.ok || !res.body) throw providerError(res.status, await res.text().catch(() => ""));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const chunk = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) yield text;
        } catch {
          // 忽略无法解析的分片
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
