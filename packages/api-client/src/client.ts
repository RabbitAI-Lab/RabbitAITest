import type { Envelope } from '@rabbit/shared';

/** 前端唯一 HTTP 层（AGENTS 门禁 4：禁止手写 fetch 绕过）。 */
export class ApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly status: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function baseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE ?? '';
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
    credentials: 'same-origin',
  });
  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    // 非 JSON 响应（网关错误等）
  }
  if (!res.ok || !body || body.code !== 0) {
    throw new ApiError(
      body?.code ?? 50000,
      body?.message ?? `请求失败（HTTP ${res.status}）`,
      res.status,
      body?.data ?? undefined,
    );
  }
  return body.data as T;
}

export const get = <T>(path: string) => request<T>(path);
export const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) });
export const put = <T>(path: string, data: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(data) });
export const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });
