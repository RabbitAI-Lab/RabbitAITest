/** API-004 HTTP 采样器 v2：渲染后请求 → 7 类 body / 认证(Basic+Digest) / 重定向循环 / HOST 映射。 */
import { Agent, FormData, buildConnector, request as undiciRequest } from "undici";
import type { RequestSpec } from "@rabbit/shared/execution";
import { createHash, randomBytes } from "node:crypto";
import { config } from "@rabbit/shared";

export interface HttpResult {
  status: number;
  headers: { key: string; value: string }[];
  bodyText: string;
  truncated: boolean;
  durationMs: number;
  requestUrl: string; // 渲染后实际 URL（含重定向最终地址）
  redirects: string[]; // 经过的 Location 链
}

export interface SampleOptions {
  hosts: Map<string, string>; // HOST 映射（PROJ-003）
  signal?: AbortSignal; // 停止信号（EXEC-002）
}

const MAX_BODY = 256 * 1024;
const MAX_REDIRECTS = 5;

/** 内部文件拉取（web internal 端点；engine 无 DB，API-004 §4）。 */
async function fetchFile(fileId: string): Promise<{ bytes: Buffer; name: string; mime: string }> {
  const res = await fetch(`${config.webUrl}/api/v1/internal/files/${fileId}`, {
    headers: { "X-Internal-Token": config.internalToken },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`引用文件拉取失败（${fileId.slice(0, 8)} HTTP ${res.status}）`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  return {
    bytes,
    name: decodeURIComponent(res.headers.get("X-File-Name") ?? "file"),
    mime: res.headers.get("X-File-Mime") ?? "application/octet-stream",
  };
}

function defaultContentType(kind: RequestSpec["body"]["kind"]): string | undefined {
  switch (kind) {
    case "raw_json":
      return "application/json";
    case "raw_xml":
      return "application/xml";
    case "raw_text":
      return "text/plain";
    default:
      return undefined;
  }
}

interface PreparedRequest {
  url: string;
  method: RequestSpec["method"];
  headers: Record<string, string>;
  body?: string | FormData | Uint8Array;
}

async function prepare(spec: RequestSpec, absoluteUrl: string): Promise<PreparedRequest> {
  const headers: Record<string, string> = {};
  for (const h of spec.headers) {
    if (h.enabled) headers[h.key] = h.value;
  }
  const kind = spec.body.kind;
  let body: PreparedRequest["body"];
  if (kind === "form_data") {
    const fd = new FormData();
    for (const row of spec.body.rows) {
      if (!row.enabled) continue;
      if (row.type === "file" && row.fileId) {
        const f = await fetchFile(row.fileId);
        fd.append(row.key, new Blob([new Uint8Array(f.bytes)], { type: f.mime }), f.name);
      } else {
        fd.append(row.key, row.value);
      }
    }
    body = fd;
  } else if (kind === "form_urlencoded") {
    body = new URLSearchParams(
      spec.body.rows.filter((r) => r.enabled).map((r) => [r.key, r.value]),
    ).toString();
    if (headers["Content-Type"] === undefined)
      headers["Content-Type"] = "application/x-www-form-urlencoded";
  } else if (kind === "binary" && spec.method !== "GET" && spec.method !== "HEAD") {
    const f = await fetchFile(spec.body.fileId);
    body = new Uint8Array(f.bytes);
    if (headers["Content-Type"] === undefined) headers["Content-Type"] = f.mime;
  } else if (
    (kind === "raw_json" || kind === "raw_xml" || kind === "raw_text") &&
    spec.body.content &&
    spec.method !== "GET" &&
    spec.method !== "HEAD"
  ) {
    body = spec.body.content;
    if (headers["Content-Type"] === undefined) {
      const ct = defaultContentType(kind);
      if (ct) headers["Content-Type"] = ct;
    }
  }
  // 认证（NoAuth/Basic/Digest——Digest 在采样循环内 401 挑战后补算）
  if (spec.auth.kind === "basic") {
    headers["Authorization"] =
      `Basic ${Buffer.from(`${spec.auth.username}:${spec.auth.password}`).toString("base64")}`;
  }
  return { url: absoluteUrl, method: spec.method, headers, body };
}

async function dispatch(
  agent: Agent,
  req: PreparedRequest,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{
  status: number;
  headers: { key: string; value: string }[];
  bodyText: string;
  rawWwwAuth?: string;
}> {
  const res = await undiciRequest(req.url, {
    method: req.method,
    headers: req.headers,
    body: (req.body ?? null) as string | Uint8Array | import("undici").FormData | null,
    bodyTimeout: timeoutMs,
    headersTimeout: timeoutMs,
    dispatcher: agent,
    signal,
  });
  const buf = await res.body.arrayBuffer();
  const text = Buffer.from(buf).toString("utf8");
  const headers = Object.entries(res.headers)
    .filter(([, v]) => v !== undefined)
    .map(([key, v]) => ({ key, value: Array.isArray(v) ? v.join(", ") : String(v) }))
    .slice(0, 50);
  const www = res.headers["www-authenticate"];
  return {
    status: res.statusCode,
    headers,
    bodyText: text.length > MAX_BODY ? text.slice(0, MAX_BODY) : text,
    rawWwwAuth: typeof www === "string" ? www : undefined,
  };
}

/** RFC7616 Digest（algorithm=MD5, qop=auth）挑战应答。 */
export function buildDigestHeader(
  challenge: string,
  method: string,
  uri: string,
  username: string,
  password: string,
): string | undefined {
  const params: Record<string, string> = {};
  for (const part of challenge.replace(/^Digest\s*/i, "").split(",")) {
    const i = part.indexOf("=");
    if (i > 0) {
      const k = part.slice(0, i).trim();
      let v = part.slice(i + 1).trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      params[k] = v;
    }
  }
  if (!params.realm || !params.nonce) return undefined;
  const algorithm = (params.algorithm ?? "MD5").toUpperCase();
  if (algorithm !== "MD5") return undefined; // MD5-sess/SHA-256 不支持（登记）
  const qop = (params.qop ?? "").split(",")[0]?.trim() || undefined;
  const cnonce = randomBytes(8).toString("hex");
  const nc = "00000001";
  const H = (s: string) => createHash("md5").update(s).digest("hex");
  const ha1 = H(`${username}:${params.realm}:${password}`);
  const ha2 = H(`${method}:${uri}`);
  const response =
    qop === "auth"
      ? H(`${ha1}:${params.nonce}:${nc}:${cnonce}:auth:${ha2}`)
      : H(`${ha1}:${params.nonce}:${ha2}`);
  const parts = [
    `username="${username}"`,
    `realm="${params.realm}"`,
    `nonce="${params.nonce}"`,
    `uri="${uri}"`,
    `algorithm=MD5`,
    `response="${response}"`,
  ];
  if (qop) parts.push(`qop=auth`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (params.opaque) parts.push(`opaque="${params.opaque}"`);
  return `Digest ${parts.join(", ")}`;
}

export async function httpSample(
  spec: RequestSpec,
  absoluteUrl: string,
  log: (msg: string) => void,
  opts: SampleOptions = { hosts: new Map() },
): Promise<HttpResult> {
  const base = buildConnector({ timeout: spec.timeoutMs });
  const hosts = opts.hosts;
  const agent = new Agent({
    connect(opts, cb) {
      // HOST 映射（PROJ-003）：按目标主机名重定向连接地址，Host 头与 URL 不变
      const name = String(opts.hostname ?? opts.host ?? "");
      const mapped = name ? hosts.get(name) : undefined;
      if (mapped) {
        log(`HOST 映射：${name} → ${mapped}`);
        return base({ ...opts, hostname: mapped, host: mapped }, cb);
      }
      return base(opts, cb);
    },
  });
  try {
    const started = Date.now();
    let current = await prepare(spec, absoluteUrl);
    const redirects: string[] = [];
    let res = await dispatch(agent, current, spec.timeoutMs, opts.signal);
    // Digest 401 挑战重试一次
    if (
      spec.auth.kind === "digest" &&
      res.status === 401 &&
      res.rawWwwAuth?.toLowerCase().startsWith("digest")
    ) {
      const u = new URL(current.url);
      const header = buildDigestHeader(
        res.rawWwwAuth,
        current.method,
        u.pathname + u.search,
        spec.auth.username,
        spec.auth.password,
      );
      if (header) {
        log("Digest 挑战：已计算应答重试一次");
        current = { ...current, headers: { ...current.headers, Authorization: header } };
        res = await dispatch(agent, current, spec.timeoutMs, opts.signal);
      }
    }
    // 重定向跟随（≤5 次；301/302/303 → GET，307/308 保方法）
    let guard = 0;
    while (spec.followRedirects && res.status >= 300 && res.status < 400 && guard < MAX_REDIRECTS) {
      const loc = res.headers.find((h) => h.key.toLowerCase() === "location")?.value;
      if (!loc) break;
      const nextUrl = new URL(loc, current.url).toString();
      redirects.push(loc);
      log(`重定向：${res.status} → ${loc}`);
      let method = current.method;
      let body = current.body;
      if (res.status === 301 || res.status === 302 || res.status === 303) {
        if (method !== "GET" && method !== "HEAD") {
          method = "GET";
          body = undefined;
          delete current.headers["Content-Type"];
        }
      }
      current = { ...current, url: nextUrl, method, body };
      res = await dispatch(agent, current, spec.timeoutMs, opts.signal);
      guard += 1;
    }
    const durationMs = Date.now() - started;
    return {
      status: res.status,
      headers: res.headers,
      bodyText: res.bodyText,
      truncated: res.bodyText.length >= MAX_BODY,
      durationMs,
      requestUrl: current.url,
      redirects,
    };
  } finally {
    await agent.close().catch(() => {});
  }
}
