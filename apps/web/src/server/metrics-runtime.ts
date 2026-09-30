/**
 * INFRA-008：web 进程运行时指标（Node 内建 API 零依赖；命名对齐 client_golang 惯例）。
 * 事件循环延迟：monitorEventLoopDelay 直方图 mean，读后 reset——窗口=两次抓取间隔。
 * INFRA-009：runtimeBlock 增加 process label（web=自采）；engineProcRows 由池心跳 proc 构造 engine-* 行。
 */
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { escapeLabelValue } from "./metrics-format";

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

/** 完整 exposition 块（HELP/TYPE/样本行）——纯函数便于单测；process label（INFRA-009）。 */
export function runtimeBlock(s: RuntimeSnapshot, processLabel = "web"): string[] {
  const l = `process="${escapeLabelValue(processLabel)}"`;
  return [
    "# HELP rabbit_process_uptime_seconds Process uptime in seconds (process='web' self-sampled; 'engine-*' from pool heartbeat proc).",
    "# TYPE rabbit_process_uptime_seconds gauge",
    `rabbit_process_uptime_seconds{${l}} ${num(s.uptimeSeconds)}`,
    "# HELP rabbit_process_cpu_seconds_total Cumulative CPU seconds, user+system; resets on restart.",
    "# TYPE rabbit_process_cpu_seconds_total counter",
    `rabbit_process_cpu_seconds_total{${l}} ${num(s.cpuSeconds)}`,
    "# HELP rabbit_process_resident_memory_bytes Resident set size in bytes.",
    "# TYPE rabbit_process_resident_memory_bytes gauge",
    `rabbit_process_resident_memory_bytes{${l}} ${Math.round(num(s.rssBytes))}`,
    "# HELP rabbit_process_heap_used_bytes V8 heap used bytes.",
    "# TYPE rabbit_process_heap_used_bytes gauge",
    `rabbit_process_heap_used_bytes{${l}} ${Math.round(num(s.heapUsedBytes))}`,
    "# HELP rabbit_process_eventloop_lag_ms Mean event loop delay ms; web-only (histogram resets after each scrape, window = scrape interval).",
    "# TYPE rabbit_process_eventloop_lag_ms gauge",
    `rabbit_process_eventloop_lag_ms{${l}} ${num(s.eventLoopLagMs)}`,
  ];
}

/** INFRA-009：engine 节点心跳 proc → 指标行（缺 proc/字段非法跳过；eventloop 无——HELP 已注明 web-only）。 */
export function engineProcRows(
  nodes: Array<{
    nodeId?: unknown;
    proc?: {
      uptimeSeconds?: unknown;
      cpuSeconds?: unknown;
      rssBytes?: unknown;
      heapUsedBytes?: unknown;
    } | null;
  }>,
): string[] {
  const lines: string[] = [];
  for (const n of nodes) {
    const id = typeof n.nodeId === "string" && n.nodeId ? n.nodeId : undefined;
    const p = n.proc;
    if (!id || !p) continue;
    const up = Number(p.uptimeSeconds);
    const cpu = Number(p.cpuSeconds);
    const rss = Number(p.rssBytes);
    const heap = Number(p.heapUsedBytes);
    if (![up, cpu, rss, heap].every((v) => Number.isFinite(v) && v >= 0)) continue;
    const l = `process="engine-${escapeLabelValue(id)}"`;
    lines.push(
      `rabbit_process_uptime_seconds{${l}} ${up}`,
      `rabbit_process_cpu_seconds_total{${l}} ${cpu}`,
      `rabbit_process_resident_memory_bytes{${l}} ${Math.round(rss)}`,
      `rabbit_process_heap_used_bytes{${l}} ${Math.round(heap)}`,
    );
  }
  return lines;
}

