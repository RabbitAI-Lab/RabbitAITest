/**
 * 进程内 HTTP 计数器 + 时延环形缓冲（INFRA-004 /system/metrics 数据源；
 * INFRA-007 v2 扩展 httpObserve——每路由组最近 WINDOW 样本滑动窗口；
 * INFRA-010 加法式 histogram——同点双写桶计数器（seconds 族，跨副本可聚合））。
 * 内存累计、重启归零（单进程口径，登记于指标 HELP；外采聚合由 Prometheus 自行 rate() 处理）。
 */
import { DURATION_BUCKETS_S } from "./metrics-format";

type Key = string; // `${routeGroup}|${statusClass}`

/** 每路由组时延缓冲上限（滑动窗口：只反映最近样本，非进程生命周期累计）。 */
export const DURATION_WINDOW = 512;

interface HistogramEntry {
  /** 与 DURATION_BUCKETS_S 对齐的非累积桶计数 */
  counts: number[];
  /** 秒累计 */
  sum: number;
  count: number;
}

const globalForMetrics = globalThis as unknown as {
  __httpCounters?: Map<Key, number>;
  __httpDurations?: Map<string, number[]>;
  __httpHistograms?: Map<string, HistogramEntry>;
};

function counters(): Map<Key, number> {
  if (!globalForMetrics.__httpCounters) globalForMetrics.__httpCounters = new Map();
  return globalForMetrics.__httpCounters;
}

function durations(): Map<string, number[]> {
  if (!globalForMetrics.__httpDurations) globalForMetrics.__httpDurations = new Map();
  return globalForMetrics.__httpDurations;
}

function histograms(): Map<string, HistogramEntry> {
  if (!globalForMetrics.__httpHistograms) globalForMetrics.__httpHistograms = new Map();
  return globalForMetrics.__httpHistograms;
}

/** route_group：/api/v1/{group}/... 取第一段（projects/orgs/system/...），无组则 root。 */
export function routeGroupOf(path: string): string {
  const m = path.match(/^\/api\/v1\/([^/?]+)/);
  const g = m?.[1];
  if (!g) return "root";
  return /^projects$|^orgs$|^system$|^exec-tasks$/.test(g)
    ? g
    : g.replace(/[^a-z0-9-]/gi, "") || "other";
}

export function httpIncr(path: string, status: number): void {
  const key = `${routeGroupOf(path)}|${Math.floor(status / 100)}xx`;
  counters().set(key, (counters().get(key) ?? 0) + 1);
}

/** INFRA-007：请求时延入组缓冲（guard accessLog 出口埋点；ms 非法值丢弃）。 */
export function httpObserve(path: string, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const group = routeGroupOf(path);
  const buf = durations().get(group) ?? [];
  buf.push(ms);
  if (buf.length > DURATION_WINDOW) buf.splice(0, buf.length - DURATION_WINDOW);
  durations().set(group, buf);
  // INFRA-010：同点双写 histogram 桶（秒界；超上限样本落 +Inf 语义——counts 全不加，仅 count/sum 增）
  const s = ms / 1000;
  const entry = histograms().get(group) ?? {
    counts: DURATION_BUCKETS_S.map(() => 0),
    sum: 0,
    count: 0,
  };
  const idx = DURATION_BUCKETS_S.findIndex((b) => s <= b);
  if (idx >= 0) entry.counts[idx] = (entry.counts[idx] ?? 0) + 1;
  entry.sum += s;
  entry.count += 1;
  histograms().set(group, entry);
}

export function httpCounterSnapshot(): Array<{
  routeGroup: string;
  statusClass: string;
  value: number;
}> {
  return [...counters().entries()].map(([k, v]) => {
    const [routeGroup, statusClass] = k.split("|") as [string, string];
    return { routeGroup, statusClass, value: v };
  });
}

export function httpDurationSnapshot(): Array<{
  routeGroup: string;
  samples: number[];
  sum: number;
}> {
  return [...durations().entries()].map(([routeGroup, buf]) => ({
    routeGroup,
    samples: [...buf],
    sum: buf.reduce((a, b) => a + b, 0),
  }));
}

export function httpHistogramSnapshot(): Array<{
  routeGroup: string;
  counts: number[];
  sum: number;
  count: number;
}> {
  return [...histograms().entries()].map(([routeGroup, e]) => ({
    routeGroup,
    counts: [...e.counts],
    sum: e.sum,
    count: e.count,
  }));
}
