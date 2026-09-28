/**
 * 协议插件注册表（PLUG-002 §2）：engine 进程内加载（采样热路径不跨进程——plugin-architecture §2）。
 * 30s 轮询 web internal 端点同步启用清单（版本变更才拉包）；解包目录 dynamic import；
 * 约定：协议标识 = 插件名（tcp-conn → "tcp-conn"；勘误见 PLUG-002 §8）。
 */
import type { SamplerPlugin, SamplerResult } from "@rabbit/shared";

interface ProtocolInfo {
  protocol: string;
  name: string;
  version: string;
  dir: string;
  entry: string;
}

const globalForRegistry = globalThis as unknown as {
  __rabbitSamplerRegistry?: Map<string, { plugin: SamplerPlugin; version: string }>;
};

function registry(): Map<string, { plugin: SamplerPlugin; version: string }> {
  if (!globalForRegistry.__rabbitSamplerRegistry) {
    globalForRegistry.__rabbitSamplerRegistry = new Map();
  }
  return globalForRegistry.__rabbitSamplerRegistry;
}

function webBaseUrl(): string {
  return process.env.WEB_INTERNAL_URL ?? "http://127.0.0.1:3000";
}

function internalToken(): string {
  return process.env.INTERNAL_TOKEN ?? "rabbit-internal";
}

async function fetchProtocols(): Promise<ProtocolInfo[]> {
  try {
    const res = await fetch(`${webBaseUrl()}/api/v1/internal/plugins/protocols`, {
      headers: { Authorization: `Bearer ${internalToken()}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: ProtocolInfo[] };
    return json.data ?? [];
  } catch {
    return [];
  }
}

let syncTimer: NodeJS.Timeout | null = null;

/** 启动周期同步（engine worker 启动时调用；幂等） */
export function startProtocolSync(): void {
  if (syncTimer) return;
  syncTimer = setInterval(() => void syncOnce(), 30_000);
  void syncOnce();
}

export async function syncOnce(): Promise<void> {
  const list = await fetchProtocols();
  const reg = registry();
  const wanted = new Map(list.map((p) => [p.protocol, p]));
  // 卸载已停用
  for (const key of [...reg.keys()]) {
    if (!wanted.has(key)) reg.delete(key);
  }
  // 加载/升级（版本变更才 import；import 路径含版本号天然缓存隔离）
  for (const info of wanted.values()) {
    const current = reg.get(info.protocol);
    if (current && current.version === info.version) continue;
    try {
      const mod = (await import(`${info.dir}/${info.entry}`)) as {
        default?: () => SamplerPlugin;
        createPlugin?: () => SamplerPlugin;
      };
      const factory = mod.default ?? mod.createPlugin;
      if (!factory) throw new Error("入口未导出 default/createPlugin 工厂");
      reg.set(info.protocol, { plugin: factory(), version: info.version });
    } catch (err) {
      // 加载失败：注册表不变更（保持旧版本可用），结构化日志
      console.error(
        `[samplers] 协议插件加载失败 ${info.protocol}@${info.version}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

/** 按协议取采样器（不存在 → null，调用方报 CONFIG_ERROR 40510） */
export function getSamplerPlugin(protocol: string): SamplerPlugin | null {
  return registry().get(protocol)?.plugin ?? null;
}

export function listProtocols(): string[] {
  return [...registry().keys()];
}

/** 协议采样结果 → responseSummary 形态（PLUG-002 §4：SamplerResult 标准化映射） */
export function samplerResultToSummary(result: SamplerResult): {
  status: number;
  bodyText: string;
  responseTimeMs: number;
  headers: Record<string, string>;
} {
  return {
    status: result.ok ? 200 : 502,
    bodyText: result.bodyText.slice(0, 4096),
    responseTimeMs: result.responseTimeMs,
    headers: result.headers ?? {},
  };
}
