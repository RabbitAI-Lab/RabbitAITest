import type { EventFrame } from '@rabbit/shared';
import { eventFrameSchema } from '@rabbit/shared';

/** SSE 消费（api-conventions §5）：断线自动重连 + Last-Event-ID 续传。 */
export async function streamExecFrames(
  taskId: string,
  onFrame: (frame: EventFrame) => void,
  signal?: AbortSignal,
): Promise<void> {
  let lastEventId = '';
  for (;;) {
    if (signal?.aborted) return;
    let stream: ReadableStream<Uint8Array> | null = null;
    try {
      const res = await fetch(`/api/v1/stream/exec/${taskId}`, {
        headers: lastEventId ? { 'Last-Event-ID': lastEventId } : {},
        credentials: 'same-origin',
        signal,
      });
      if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`);
      stream = res.body;
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return; // 服务端终态后正常关闭
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split('\n\n');
        buf = blocks.pop() ?? '';
        for (const block of blocks) {
          const idLine = block.split('\n').find((l) => l.startsWith('id:'));
          const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          if (idLine) lastEventId = idLine.slice(3).trim();
          try {
            onFrame(eventFrameSchema.parse(JSON.parse(dataLine.slice(5).trim())));
          } catch {
            // 忽略无法解析的帧
          }
        }
      }
    } catch (e) {
      if (signal?.aborted) return;
      if (e instanceof DOMException && e.name === 'AbortError') return;
      await new Promise((r) => setTimeout(r, 1500)); // 断线退避重连
    }
  }
}
