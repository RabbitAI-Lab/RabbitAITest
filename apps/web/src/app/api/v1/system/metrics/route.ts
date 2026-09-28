/**
 * INFRA-004：系统指标面（Prometheus 文本格式；rules/observability.md §6 最小指标集）。
 * 权限 SYSTEM_METRICS:READ（系统管理员；Prometheus 抓取建议内网+会话转发，部署文档注明）。
 * 响应为 text/plain 非统一信封（Prometheus 抓取格式约定——api-conventions 例外登记于规格 §4）。
 */
import { NextResponse } from "next/server";
import { prisma } from "@rabbit/db";
import { withSystemPerm } from "@/server/guard";
import { execQueue } from "@/server/redis";
import { httpCounterSnapshot } from "@/server/metrics-counter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

export const GET = withSystemPerm("SYSTEM_METRICS:READ")(async () => {
  const lines: string[] = [];

  // ── 队列（BullMQ）──
  let queueOk = true;
  const counts = await execQueue()
    .getJobCounts("wait", "delayed", "active", "failed")
    .catch(() => {
      queueOk = false;
      return null;
    });
  lines.push(
    "# HELP rabbit_queue_depth BullMQ waiting+delayed jobs (exec queue). Restart of Redis resets backlog visibility, not the queue itself.",
  );
  lines.push("# TYPE rabbit_queue_depth gauge");
  lines.push(
    `rabbit_queue_depth{pool="exec"} ${queueOk ? (counts?.wait ?? 0) + (counts?.delayed ?? 0) : 0}`,
  );
  lines.push("# HELP rabbit_queue_active BullMQ active jobs (exec queue).");
  lines.push("# TYPE rabbit_queue_active gauge");
  lines.push(`rabbit_queue_active{pool="exec"} ${queueOk ? (counts?.active ?? 0) : 0}`);
  lines.push(
    "# HELP rabbit_queue_dead BullMQ failed jobs (exec queue; includes retryable failures until exhausted).",
  );
  lines.push("# TYPE rabbit_queue_dead gauge");
  lines.push(`rabbit_queue_dead{pool="exec"} ${queueOk ? (counts?.failed ?? 0) : 0}`);

  // ── 引擎并发槽（默认资源池心跳快照）──
  const pool = await prisma.resourcePool
    .findFirst({ where: { isDefault: true } })
    .catch(() => null);
  const nodes = Array.isArray(pool?.nodes)
    ? (pool?.nodes as Array<{ slots?: { used?: number; cap?: number } }>)
    : [];
  const used = nodes.reduce((acc, n) => acc + (n.slots?.used ?? 0), 0);
  const cap = pool?.maxConcurrency ?? 0;
  lines.push("# HELP rabbit_engine_slots Engine concurrency slots from latest pool heartbeat.");
  lines.push("# TYPE rabbit_engine_slots gauge");
  lines.push(`rabbit_engine_slots{state="used"} ${used}`);
  lines.push(`rabbit_engine_slots{state="cap"} ${cap}`);

  // ── 任务时长分位（近 1h 终态任务，DB 聚合）──
  const durations = await prisma.$queryRaw<Array<{ duration_ms: number | null }>>`
    SELECT duration_ms FROM exec_tasks
    WHERE status IN ('SUCCESS','FAILED') AND finished_at > now() - interval '1 hour' AND duration_ms IS NOT NULL
  `.catch(() => [] as Array<{ duration_ms: number | null }>);
  const sorted = durations.map((r) => Number(r.duration_ms)).sort((a, b) => a - b);
  lines.push("# HELP rabbit_task_duration_ms Finished task duration quantiles over last 1h.");
  lines.push("# TYPE rabbit_task_duration_ms summary");
  lines.push(`rabbit_task_duration_ms{quantile="0.5"} ${percentile(sorted, 0.5)}`);
  lines.push(`rabbit_task_duration_ms{quantile="0.95"} ${percentile(sorted, 0.95)}`);
  lines.push(`rabbit_task_duration_ms_sum ${sorted.reduce((a, b) => a + b, 0)}`);
  lines.push(`rabbit_task_duration_ms_count ${sorted.length}`);

  // ── HTTP 计数（进程内，重启归零）──
  lines.push(
    "# HELP rabbit_http_requests_total HTTP requests by route group and status class (in-process counter, resets on restart).",
  );
  lines.push("# TYPE rabbit_http_requests_total counter");
  for (const c of httpCounterSnapshot()) {
    lines.push(
      `rabbit_http_requests_total{route_group="${c.routeGroup}",status_class="${c.statusClass}"} ${c.value}`,
    );
  }

  return new NextResponse(`${lines.join("\n")}\n`, {
    status: 200,
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
    },
  });
});
