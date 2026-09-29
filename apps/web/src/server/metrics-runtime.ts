/**
 * INFRA-008：web 进程运行时指标（Node 内建 API 零依赖；命名对齐 client_golang 惯例）。
 * 事件循环延迟：monitorEventLoopDelay 直方图 mean，读后 reset——窗口=两次抓取间隔。
 */
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

const g = globalThis as unknown as { __rabbitLoopMonitor?: IntervalHistogram };

function loopMonitor(): IntervalHistogram {
  if (!g.__rabbitLoopMonitor) {
    const m = monitorEventLoopDelay({ resolution: 20 });
    m.enable();
    g.__rabbitLoopMonitor = m;
  }
  return g.__rabbitLoopMonitor;
}

export interface RuntimeSnapshot {
  uptimeSeconds: number;
  cpuSeconds: number;
  rssBytes: number;
  heapUsedBytes: number;
  eventLoopLagMs: number;
}

export function runtimeSnapshot(): RuntimeSnapshot {
  const cpu = process.cpuUsage();
  const mem = process.memoryUsage();
  const monitor = loopMonitor();
  const eventLoopLagMs = monitor.mean / 1e6;
  monitor.reset();
  return {
    uptimeSeconds: process.uptime(),
    cpuSeconds: (cpu.user + cpu.system) / 1e6,
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    eventLoopLagMs,
  };
}

function num(n: number): number {
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** 完整 exposition 块（HELP/TYPE/样本行）——纯函数便于单测。 */
export function runtimeBlock(s: RuntimeSnapshot): string[] {
  return [
    "# HELP rabbit_process_uptime_seconds Web process uptime in seconds (process.uptime).",
    "# TYPE rabbit_process_uptime_seconds gauge",
    `rabbit_process_uptime_seconds ${num(s.uptimeSeconds)}`,
    "# HELP rabbit_process_cpu_seconds_total Cumulative CPU seconds, user+system (process.cpuUsage); resets on restart.",
    "# TYPE rabbit_process_cpu_seconds_total counter",
    `rabbit_process_cpu_seconds_total ${num(s.cpuSeconds)}`,
    "# HELP rabbit_process_resident_memory_bytes Resident set size in bytes (process.memoryUsage).",
    "# TYPE rabbit_process_resident_memory_bytes gauge",
    `rabbit_process_resident_memory_bytes ${Math.round(num(s.rssBytes))}`,
    "# HELP rabbit_process_heap_used_bytes V8 heap used bytes.",
    "# TYPE rabbit_process_heap_used_bytes gauge",
    `rabbit_process_heap_used_bytes ${Math.round(num(s.heapUsedBytes))}`,
    "# HELP rabbit_process_eventloop_lag_ms Mean event loop delay ms; histogram resets after each scrape (window = scrape interval).",
    "# TYPE rabbit_process_eventloop_lag_ms gauge",
    `rabbit_process_eventloop_lag_ms ${num(s.eventLoopLagMs)}`,
  ];
}
