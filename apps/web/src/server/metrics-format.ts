/**
 * INFRA-007：/system/metrics 文本组装的纯函数集（指标段格式化/分位/比率/label 转义）。
 * 与数据源解耦以便单测；Prometheus 文本格式（exposition format §2）。
 */

/** Prometheus 文本格式 label 值转义：反斜杠/双引号/换行。 */
export function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/** 分位（与 INFRA-004 v1 同算法：最近上取整样本；空集返回 0——沿用 v1 语义）。 */
export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

/** 比率（分母 ≤0 → 0；保证指标面无 NaN）。 */
export function ratio(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

/** 失败分类行：failure_kind NULL → UNCLASSIFIED（规格 §2.1 契约）。 */
export function failureKindRows(rows: Array<{ kind: string | null; n: number }>): string[] {
  return rows.map(
    (r) => `rabbit_task_failures_24h{kind="${escapeLabelValue(r.kind ?? "UNCLASSIFIED")}"} ${r.n}`,
  );
}

/** 24h 任务分布行：status 分组计数。 */
export function taskStatusRows(rows: Array<{ status: string; n: number }>): string[] {
  return rows.map((r) => `rabbit_tasks_24h{status="${escapeLabelValue(r.status)}"} ${r.n}`);
}

/** INFRA-008 采样器错误分类行：exec_items.result.errorCode 分组（枚举见规格 §2.1）。 */
export function samplerErrorRows(rows: Array<{ code: string; n: number }>): string[] {
  return rows.map((r) => `rabbit_sampler_errors_24h{code="${escapeLabelValue(r.code)}"} ${r.n}`);
}

/** HTTP 时延 summary 行：quantile 0.5/0.95 + 窗口 sum/count（空组跳过——不虚造 0 值）。 */
export function httpDurationRows(
  snap: Array<{ routeGroup: string; samples: number[]; sum: number }>,
): string[] {
  const lines: string[] = [];
  for (const g of snap) {
    if (g.samples.length === 0) continue;
    const sorted = [...g.samples].sort((a, b) => a - b);
    const label = `route_group="${escapeLabelValue(g.routeGroup)}"`;
    lines.push(
      `rabbit_http_request_duration_ms{${label},quantile="0.5"} ${percentile(sorted, 0.5)}`,
    );
    lines.push(
      `rabbit_http_request_duration_ms{${label},quantile="0.95"} ${percentile(sorted, 0.95)}`,
    );
    lines.push(`rabbit_http_request_duration_ms_sum{${label}} ${g.sum}`);
    lines.push(`rabbit_http_request_duration_ms_count{${label}} ${g.samples.length}`);
  }
  return lines;
}
