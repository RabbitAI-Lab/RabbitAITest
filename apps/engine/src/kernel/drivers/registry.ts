/**
 * 驱动插件注册表（PLUG-004 §4）：engine in-process 加载（SQL 前后置执行面——
 * 与协议注册表同模式：30s 轮询 web internal 端点同步启用清单（版本变更才拉包），
 * 解包目录 dynamic import；driver 标识=插件名）。
 */
import type { DriverPlugin } from "@rabbit/shared";

interface DriverInfo {
  driver: string;
  name: string;
  version: string;
  dir: string;
  entry: string;
}

const globalForDriverRegistry = globalThis as unknown as {
  __rabbitDriverRegistry?: Map<string, { plugin: DriverPlugin; version: string }>;
};

function registry(): Map<string, { plugin: DriverPlugin; version: string }> {
  if (!globalForDriverRegistry.__rabbitDriverRegistry) {
    globalForDriverRegistry.__rabbitDriverRegistry = new Map();
  }
  return globalForDriverRegistry.__rabbitDriverRegistry;
}

function webBaseUrl(): string {
  // WEB_INTERNAL_URL 显式优先；缺省回退 WEB_URL（PLUG-002 勘误 4 同 pathology）
  return process.env.WEB_INTERNAL_URL ?? process.env.WEB_URL ?? "http://127.0.0.1:3000";
}

function internalToken(): string {
  return process.env.INTERNAL_TOKEN ?? "rabbit-internal";
}

async function fetchDrivers(): Promise<DriverInfo[]> {
  try {
    const res = await fetch(`${webBaseUrl()}/api/v1/internal/plugins/drivers`, {
      headers: { "x-internal-token": internalToken() },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: DriverInfo[] };
    return json.data ?? [];
  } catch {
    return [];
  }
}

let syncTimer: NodeJS.Timeout | null = null;

/** 启动周期同步（engine worker 启动时调用；幂等） */
export function startDriverSync(): void {
  if (syncTimer) return;
  syncTimer = setInterval(() => void syncOnce(), 30_000);
  void syncOnce();
}

export async function syncOnce(): Promise<void> {
  const list = await fetchDrivers();
  const reg = registry();
  const wanted = new Map(list.map((p) => [p.driver, p]));
  for (const key of [...reg.keys()]) {
    if (!wanted.has(key)) reg.delete(key);
  }
  for (const info of wanted.values()) {
    const current = reg.get(info.driver);
    if (current && current.version === info.version) continue;
    try {
      const mod = (await import(`${info.dir}/${info.entry}`)) as {
        default?:
          | (() => DriverPlugin)
          | { default?: () => DriverPlugin; createPlugin?: () => DriverPlugin };
        createPlugin?: () => DriverPlugin;
      };
      // CJS 双层解包（PLUG-003 勘误 5：驱动插件全部 format=cjs）
      const raw = mod.default ?? mod.createPlugin;
      const factory =
        typeof raw === "function"
          ? raw
          : typeof raw?.default === "function"
            ? raw.default
            : typeof raw?.createPlugin === "function"
              ? raw.createPlugin
              : null;
      if (!factory) throw new Error("入口未导出 default/createPlugin 工厂");
      reg.set(info.driver, { plugin: factory(), version: info.version });
    } catch (err) {
      // 加载失败：注册表不变更（保持旧版本可用），结构化日志
      console.error(
        `[drivers] 驱动插件加载失败 ${info.driver}@${info.version}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

/** 按驱动标识取插件（不存在 → null，调用方报 DRIVER_PLUGIN_MISSING 50032） */
export function getDriverPlugin(driver: string): DriverPlugin | null {
  return registry().get(driver)?.plugin ?? null;
}

export function listDrivers(): string[] {
  return [...registry().keys()];
}

/** 测试注入钩子（kernel/sql 单测：伪驱动直注注册表，不走轮询） */
export function __setDriverForTests(driver: string, plugin: DriverPlugin | null): void {
  const reg = registry();
  if (plugin === null) reg.delete(driver);
  else reg.set(driver, { plugin, version: "test" });
}
