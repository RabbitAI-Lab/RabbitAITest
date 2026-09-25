import { request as undiciRequest } from 'undici';
import type { DebugRequest } from '@rabbit/shared';

export interface HttpResult {
  status: number;
  headers: { key: string; value: string }[];
  bodyText: string;
  truncated: boolean;
  durationMs: number;
}

const MAX_BODY = 256 * 1024;

/** HTTP 采样器（undici v7：不跟随重定向，3xx 原样返回并记日志由调用方展示）。 */
export async function httpSample(req: DebugRequest, log: (msg: string) => void): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  for (const h of req.headers) headers[h.key] = h.value;
  if (req.body.kind === 'raw_json' && req.body.content && headers['Content-Type'] === undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const started = Date.now();
  const res = await undiciRequest(req.url, {
    method: req.method,
    headers,
    body: req.body.kind === 'raw_json' && req.body.content && req.method !== 'GET' && req.method !== 'HEAD'
      ? req.body.content
      : undefined,
    bodyTimeout: req.timeoutMs,
    headersTimeout: req.timeoutMs,
  });
  const buf = await res.body.arrayBuffer();
  const durationMs = Date.now() - started;
  const text = Buffer.from(buf).toString('utf8');
  if (res.statusCode >= 300 && res.statusCode < 400) {
    log(`重定向：${res.statusCode} → ${res.headers.location ?? '(无 location)'}`);
  }
  return {
    status: res.statusCode,
    headers: Object.entries(res.headers)
      .filter(([, v]) => v !== undefined)
      .map(([key, v]) => ({ key, value: Array.isArray(v) ? v.join(', ') : String(v) }))
      .slice(0, 50),
    bodyText: text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}` : text,
    truncated: text.length > MAX_BODY,
    durationMs,
  };
}
