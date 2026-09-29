/**
 * INFRA-004 + INFRA-007：系统指标面 v2（Prometheus 文本格式；rules/observability.md §6）。
 * 鉴权（INFRA-007 §2.3 矩阵）：会话优先协商（浏览器调试），无会话走 APIKEY
 * （Authorization Basic ak:sk / Bearer ak.sk，INTG-003 通道复用）；权限统一 SYSTEM_METRICS:READ；
 * APIKEY 通道限流 30 次/分（429 10012）；抓取不落审计（高频，审计面以 key 建立与吊销为准）。
 * 响应为 text/plain 非统一信封（Prometheus 抓取格式约定——api-conventions 例外登记于 INFRA-004 规格 §4）。
 * 组装分段独立降级（规格 §2.1）：任一数据源故障只影响该段，端点仍 200 输出其余指标。
 */
import { NextResponse } from "next/server";
import { ErrCode, ErrMsg, execQueueNameFor, fail } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { getActiveUserId } from "@/server/current-user";
import { permissionSetFor } from "@/server/rbac";
import { rateLimit } from "@/server/rate-limit";
import { accessLog, toResponse } from "@/server/guard";
import { parseAuthHeader, verifyApiKey } from "@/server/domains/api/apikey.service";
import { execQueueFor } from "@/server/redis";
import { httpCounterSnapshot, httpDurationSnapshot } from "@/server/metrics-counter";
import {
  escapeLabelValue,
  failureKindRows,
  httpDurationRows,
  percentile,
  ratio,
  taskStatusRows,
} from "@/server/metrics-format";
import { slowQueryCount } from "@/server/metrics-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METRICS_PERM = "SYSTEM_METRICS:READ";

function permDenied(): NextResponse {
  return NextResponse.json(fail(ErrCode.FORBIDDEN, `缺少权限点 ${METRICS_PERM}`), {
    status: 403,
  });
}

/** §2.3 鉴权矩阵：会话 → APIKEY → 401；无效 key 401（10010）；无权限 403（10003）。 */
async function resolveMetricsAuth(req: Request): Promise<NextResponse | true> {
  const sessionUser = await getActiveUserId().catch(() => null);
  if (sessionUser) {
    const perms = await permissionSetFor(sessionUser);
    return perms.has(METRICS_PERM) ? true : permDenied();
  }
  const parsed = parseAuthHeader(req.headers.get("authorization"));
  if (!parsed) {
    return NextResponse.json(fail(ErrCode.UNAUTHENTICATED, ErrMsg[ErrCode.UNAUTHENTICATED]!), {
      status: 401,
    });
  }
  let userId: string;
  try {
    userId = await verifyApiKey(parsed.accessKey, parsed.secretKey);
  } catch {
    return NextResponse.json(fail(ErrCode.APIKEY_INVALID, ErrMsg[ErrCode.APIKEY_INVALID]!), {
      status: 401,
    });
  }
  const rl = await rateLimit("system-metrics", parsed.accessKey.slice(0, 8), 30, 60);
  if (!rl.allowed) {
    return NextResponse.json(fail(ErrCode.OPEN_RATE_LIMITED, "抓取过于频繁（每 key 30 次/分钟）"), {
      status: 429,
    });
  }
  const perms = await permissionSetFor(userId);
  return perms.has(METRICS_PERM) ? true : permDenied();
}

interface PoolRow {
  id: string;
  nodes: unknown;
  maxConcurrency: number;
}

async function loadPools(): Promise<PoolRow[]> {
  try {
    return (await prisma.resourcePool.findMany({
      select: { id: true, nodes: true, maxConcurrency: true },
    })) as PoolRow[];
  } catch {
    return [];
  }
}

function poolUsedSlots(nodes: unknown): number {
  if (!Array.isArray(nodes)) return 0;
  return nodes.reduce<number>((acc, n) => {
    const used =
      typeof n === "object" && n !== null
        ? (n as { slots?: { used?: number } }).slots?.used
        : undefined;
    return acc + (Number.isFinite(Number(used)) ? Number(used) : 0);
  }, 0);
}

/** 队列段：默认队列 ∪ resource_pools 各池（label=BullMQ 队列名；Redis 断 → 0 值保留，v1 语义）。 */
async function queueSection(lines: string[], pools: PoolRow[]): Promise<void> {
  const seen = new Set<string>();
  const rows: Array<{ name: string; depth: number; active: number; dead: number }> = [];
  for (const pid of [null, ...pools.map((p) => p.id)] as Array<string | null>) {
    const name = execQueueNameFor(pid);
    if (seen.has(name)) continue;
    seen.add(name);
    const counts = await execQueueFor(pid)
      .getJobCounts("wait", "delayed", "active", "failed")
      .catch(() => null);
    rows.push({
      name,
      depth: counts ? (counts.wait ?? 0) + (counts.delayed ?? 0) : 0,
      active: counts?.active ?? 0,
      dead: counts?.failed ?? 0,
    });
  }
  lines.push(
    "# HELP rabbit_queue_depth BullMQ waiting+delayed jobs per pool queue (label = BullMQ queue name; default pool = 'exec'). Restart of Redis resets backlog visibility, not the queue itself.",
    "# TYPE rabbit_queue_depth gauge",
  );
  for (const r of rows)
    lines.push(`rabbit_queue_depth{pool="${escapeLabelValue(r.name)}"} ${r.depth}`);
  lines.push(
    "# HELP rabbit_queue_active BullMQ active jobs per pool queue.",
    "# TYPE rabbit_queue_active gauge",
  );
  for (const r of rows)
    lines.push(`rabbit_queue_active{pool="${escapeLabelValue(r.name)}"} ${r.active}`);
  lines.push(
    "# HELP rabbit_queue_dead BullMQ failed jobs per pool queue (includes retryable failures until exhausted).",
    "# TYPE rabbit_queue_dead gauge",
  );
  for (const r of rows)
    lines.push(`rabbit_queue_dead{pool="${escapeLabelValue(r.name)}"} ${r.dead}`);
}

/** 槽位段：resource_pools 逐池心跳求和（v2 起全池输出；DB 断 → 无行，段降级）。 */
function slotsSection(lines: string[], pools: PoolRow[]): void {
  lines.push(
    "# HELP rabbit_engine_slots Engine concurrency slots from latest pool heartbeat (per pool; label = BullMQ queue name).",
    "# TYPE rabbit_engine_slots gauge",
  );
  for (const p of pools) {
    const label = escapeLabelValue(execQueueNameFor(p.id));
    lines.push(`rabbit_engine_slots{pool="${label}",state="used"} ${poolUsedSlots(p.nodes)}`);
    lines.push(`rabbit_engine_slots{pool="${label}",state="cap"} ${p.maxConcurrency ?? 0}`);
  }
}

/** DB 段：近 1h 时长分位（v1 不变）+ 24h 业务面（任务分布/失败率/失败分类/误报）。 */
async function dbSection(lines: string[]): Promise<void> {
  const durations = await prisma.$queryRaw<Array<{ duration_ms: number | null }>>`
    SELECT duration_ms FROM exec_tasks
    WHERE status IN ('SUCCESS','FAILED') AND finished_at > now() - interval '1 hour' AND duration_ms IS NOT NULL
  `.catch(() => [] as Array<{ duration_ms: number | null }>);
  const sorted = durations.map((r) => Number(r.duration_ms)).sort((a, b) => a - b);
  lines.push(
    "# HELP rabbit_task_duration_ms Finished task duration quantiles over last 1h.",
    "# TYPE rabbit_task_duration_ms summary",
    `rabbit_task_duration_ms{quantile="0.5"} ${percentile(sorted, 0.5)}`,
    `rabbit_task_duration_ms{quantile="0.95"} ${percentile(sorted, 0.95)}`,
    `rabbit_task_duration_ms_sum ${sorted.reduce((a, b) => a + b, 0)}`,
    `rabbit_task_duration_ms_count ${sorted.length}`,
  );

  const byStatus = await prisma
    .$queryRawUnsafe<Array<{ status: string; n: number }>>(
      "SELECT status, count(*)::int AS n FROM exec_tasks WHERE created_at > now() - interval '24 hours' GROUP BY status",
    )
    .catch(() => [] as Array<{ status: string; n: number }>);
  lines.push(
    "# HELP rabbit_tasks_24h Exec tasks created in the last 24h, grouped by status (window gauge, recomputed each scrape).",
    "# TYPE rabbit_tasks_24h gauge",
    ...taskStatusRows(byStatus),
  );
  const total = byStatus.reduce((a, r) => a + r.n, 0);
  const failed = byStatus.find((r) => r.status === "FAILED")?.n ?? 0;
  lines.push(
    "# HELP rabbit_task_failure_rate_24h FAILED / total exec tasks created in the last 24h (0 when no tasks).",
    "# TYPE rabbit_task_failure_rate_24h gauge",
    `rabbit_task_failure_rate_24h ${ratio(failed, total)}`,
  );

  const byKind = await prisma
    .$queryRawUnsafe<Array<{ kind: string | null; n: number }>>(
      "SELECT failure_kind AS kind, count(*)::int AS n FROM exec_tasks WHERE status = 'FAILED' AND created_at > now() - interval '24 hours' GROUP BY 1",
    )
    .catch(() => [] as Array<{ kind: string | null; n: number }>);
  lines.push(
    "# HELP rabbit_task_failures_24h Failed exec tasks in the last 24h by failure_kind (engine classifyFailure persisted via callback; NULL -> UNCLASSIFIED).",
    "# TYPE rabbit_task_failures_24h gauge",
    ...failureKindRows(byKind),
  );

  const [hits, failedItems] = await Promise.all([
    prisma
      .$queryRawUnsafe<Array<{ n: number }>>(
        "SELECT count(*)::int AS n FROM false_alarm_hits WHERE created_at > now() - interval '24 hours'",
      )
      .catch(() => [{ n: 0 }] as Array<{ n: number }>),
    prisma
      .$queryRawUnsafe<Array<{ n: number }>>(
        "SELECT count(*)::int AS n FROM exec_items i JOIN exec_tasks t ON t.id = i.task_id WHERE i.status = 'FAILED' AND t.created_at > now() - interval '24 hours'",
      )
      .catch(() => [{ n: 0 }] as Array<{ n: number }>),
  ]);
  const h = hits[0]?.n ?? 0;
  const fi = failedItems[0]?.n ?? 0;
  lines.push(
    "# HELP rabbit_false_alarm_hits_24h FalseAlarmHit rows (false-alarm matches) created in the last 24h.",
    "# TYPE rabbit_false_alarm_hits_24h gauge",
    `rabbit_false_alarm_hits_24h ${h}`,
    "# HELP rabbit_false_alarm_hit_rate_24h false_alarm_hits / FAILED exec_items over the last 24h (can exceed 1: one failed item may hit multiple rules; 0 when no failures).",
    "# TYPE rabbit_false_alarm_hit_rate_24h gauge",
    `rabbit_false_alarm_hit_rate_24h ${ratio(h, fi)}`,
  );
}

/** 进程段：HTTP 计数（v1 不变）+ 时延分位（环形缓冲窗口）+ 慢查询计数。 */
function processSection(lines: string[]): void {
  lines.push(
    "# HELP rabbit_http_requests_total HTTP requests by route group and status class (in-process counter, resets on restart).",
    "# TYPE rabbit_http_requests_total counter",
  );
  for (const c of httpCounterSnapshot()) {
    lines.push(
      `rabbit_http_requests_total{route_group="${escapeLabelValue(c.routeGroup)}",status_class="${c.statusClass}"} ${c.value}`,
    );
  }
  lines.push(
    "# HELP rabbit_http_request_duration_ms HTTP request duration per route group (in-process sliding window of last 512 samples per group; resets on restart).",
    "# TYPE rabbit_http_request_duration_ms summary",
    ...httpDurationRows(httpDurationSnapshot()),
  );
  lines.push(
    "# HELP rabbit_db_slow_queries_total Prisma admin-channel queries slower than RABBIT_SLOW_QUERY_MS (default 200ms; in-process counter, resets on restart).",
    "# TYPE rabbit_db_slow_queries_total counter",
    `rabbit_db_slow_queries_total ${slowQueryCount()}`,
  );
}

export const GET = (req: Request): Promise<NextResponse> =>
  accessLog(req, async () => {
    try {
      const authed = await resolveMetricsAuth(req);
      if (authed instanceof NextResponse) return authed;
      const pools = await loadPools();
      const lines: string[] = [];
      await queueSection(lines, pools);
      slotsSection(lines, pools);
      await dbSection(lines);
      processSection(lines);
      return new NextResponse(`${lines.join("\n")}\n`, {
        status: 200,
        headers: {
          "content-type": "text/plain; version=0.0.4; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    } catch (err) {
      return toResponse(err);
    }
  });
