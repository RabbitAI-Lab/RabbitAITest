/**
 * plugin-runner 瘦客户端（PLUG-001 §4）：HTTP JSON over 127.0.0.1；
 * health 缓存 5s；默认超时 30s。runner 进程的拉起在 instrumentation.ts 完成
 * （dev/e2e 一体启动；生产可独立部署——与 S2 mock 服务同模式）。
 *
 * SSRF 边界（rules/security.md）：runner 基址只允许 loopback / RFC1918 私网（运维自建场景），
 * 公网主机一律拒绝（防配置事故把内部命令面指向公网）。URL 来源=env 固定配置，非用户输入。
 */
import { ErrCode, DomainError } from "@rabbit/shared";

// S-future PLUG-003：未显式配 URL 时跟随 PLUGIN_RUNNER_PORT（多栈并存端口隔离；内嵌启动与客户端默认同源）
const RAW_BASE =
  process.env.PLUGIN_RUNNER_URL ??
  (process.env.PLUGIN_RUNNER_PORT
    ? `http://127.0.0.1:${process.env.PLUGIN_RUNNER_PORT}`
    : "http://127.0.0.1:4010");
const DEFAULT_TIMEOUT_MS = 30_000;

const IPV4_PATTERN = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/;

function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.")) return true;
  const m = hostname.match(IPV4_PATTERN);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/** runner 基址校验：仅 loopback/私网 http(s)（见文件头 SSRF 边界） */
export function assertRunnerBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DomainError(ErrCode.PLUGIN_RUNNER_UNAVAILABLE, "PLUGIN_RUNNER_URL 非法");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DomainError(ErrCode.PLUGIN_RUNNER_UNAVAILABLE, "PLUGIN_RUNNER_URL 仅支持 http(s)");
  }
  if (!isPrivateHost(url.hostname)) {
    throw new DomainError(
      ErrCode.PLUGIN_RUNNER_UNAVAILABLE,
      "PLUGIN_RUNNER_URL 必须指向 loopback/私网主机（runner 命令面禁止公网暴露）",
    );
  }
  return url;
}

const RUNNER_BASE = assertRunnerBaseUrl(RAW_BASE);

function runnerUrl(pathname: string): string {
  return new URL(pathname, RUNNER_BASE).toString();
}

interface RunnerPlugin {
  pluginId: string;
  name: string;
  kind: string;
  version: string;
  spiVersion: string;
  platform?: string;
  protocol?: string;
  builtin: boolean;
  workerStatus: string;
  restarts: number;
  lastError?: string;
}

let healthCache: { at: number; up: boolean } | null = null;

export async function runnerHealth(): Promise<boolean> {
  if (healthCache && Date.now() - healthCache.at < 5000) return healthCache.up;
  try {
    const res = await fetch(runnerUrl("/health"), { signal: AbortSignal.timeout(2000) });
    healthCache = { at: Date.now(), up: res.ok };
  } catch {
    healthCache = { at: Date.now(), up: false };
  }
  return healthCache.up;
}

async function rpc<T>(body: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const res = await fetch(runnerUrl("/rpc"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);
  if (!res) {
    throw new DomainError(
      ErrCode.PLUGIN_RUNNER_UNAVAILABLE,
      "plugin-runner 不可达（127.0.0.1 命令面）",
    );
  }
  const json = (await res.json().catch(() => null)) as {
    code: number;
    message: string;
    data: T | null;
  } | null;
  if (!json) {
    throw new DomainError(ErrCode.PLUGIN_RUNNER_UNAVAILABLE, "plugin-runner 响应非法");
  }
  if (json.code !== 0) {
    throw new DomainError(
      json.code === 70002 ? ErrCode.PLUGIN_PACKAGE_INVALID : ErrCode.PLUGIN_RUNNER_UNAVAILABLE,
      json.message,
    );
  }
  return json.data as T;
}

export async function runnerLoad(handle: {
  pluginId: string;
  name: string;
  kind: string;
  version: string;
  spiVersion: string;
  dir: string;
  entry: string;
}): Promise<void> {
  const { dir, entry, ...rest } = handle;
  await rpc({ op: "load", handle: rest, dir, entry });
}

export async function runnerUnload(pluginId: string): Promise<void> {
  await rpc({ op: "unload", pluginId });
}

export async function runnerCall<T>(pluginId: string, method: string, args: unknown[]): Promise<T> {
  return rpc<T>({ op: "call", pluginId, method, args });
}

export async function runnerList(): Promise<RunnerPlugin[]> {
  try {
    const res = await fetch(runnerUrl("/list"), { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return [];
    const json = (await res.json()) as { plugins: RunnerPlugin[] };
    return json.plugins ?? [];
  } catch {
    return [];
  }
}
