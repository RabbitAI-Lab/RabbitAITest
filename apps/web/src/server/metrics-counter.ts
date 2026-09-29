/**
 * 进程内 HTTP 计数器（INFRA-004 /system/metrics 数据源；rules/observability.md §6）。
 * 内存累计、重启归零（单进程口径，登记于指标 HELP；外采聚合由 Prometheus 自行 rate() 处理）。
 */
type Key = string; // `${routeGroup}|${statusClass}`

const globalForMetrics = globalThis as unknown as {
  __httpCounters?: Map<Key, number>;
};

function counters(): Map<Key, number> {
  if (!globalForMetrics.__httpCounters) globalForMetrics.__httpCounters = new Map();
  return globalForMetrics.__httpCounters;
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
