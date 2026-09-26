import type { Envelope } from "@rabbit/shared";

/** 前端唯一 HTTP 层（AGENTS 门禁 4：禁止手写 fetch 绕过）。 */
export class ApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly status: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function baseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE ?? "";
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // FormData（导入/附件上传）必须保留浏览器自动生成的 multipart 边界头，
  // 强设 application/json 会让服务端 req.formData() 抛错（CASE-004 导入 500 的根因）
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { ...(isFormData ? {} : { "Content-Type": "application/json" }), ...init.headers },
    credentials: "same-origin",
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
  request<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });
export const put = <T>(path: string, data: unknown) =>
  request<T>(path, { method: "PUT", body: JSON.stringify(data) });
export const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

/** 二进制下载（模板下载/导出，非 JSON 信封响应）。POST 缺省；返回 blob 与文件名。 */
export async function downloadRaw(
  path: string,
  body?: unknown,
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(
    `${baseUrl()}${path}`,
    body === undefined
      ? { credentials: "same-origin" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          credentials: "same-origin",
        },
  );
  if (!res.ok) {
    let code = 50000;
    let message = `下载失败（HTTP ${res.status}）`;
    try {
      const j = (await res.json()) as { code?: number; message?: string };
      if (j.code !== undefined && j.code !== 0) {
        code = j.code;
        message = j.message ?? message;
      }
    } catch {
      /* 非 JSON */
    }
    throw new ApiError(code, message, res.status);
  }
  const dispo = res.headers.get("content-disposition") ?? "";
  const m = dispo.match(/filename="?([^";]+)"?/);
  return { blob: await res.blob(), filename: m?.[1] ?? "download" };
}
