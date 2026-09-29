/**
 * 审计日志（SYS-008）：withAudit() 声明式包装（api-conventions §4 预定契约）
 * + BullMQ 异步落库（降级直写）+ 三级范围查询 + 保留清理。
 */
import { NextResponse } from "next/server";
import { DomainError, ErrCode, ok, auditLogQuerySchema } from "@rabbit/shared";
import { prisma, runAsAdmin } from "@rabbit/db";
import { scheduleQueue } from "@/server/redis";

type Query = ReturnType<typeof auditLogQuerySchema.parse>;

// ── 落库通道（BullMQ 异步批量；不可用降级直写）──

interface AuditEvent {
  userId: string | null;
  scope: "system" | "org" | "project";
  projectId?: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  detail?: Record<string, unknown> | null;
  ip?: string | null;
}

const AUDIT_QUEUE_NAME = "audit";
const globalForAudit = globalThis as unknown as { __rabbitAuditBuffer?: AuditEvent[] };

function buffer(): AuditEvent[] {
  if (!globalForAudit.__rabbitAuditBuffer) globalForAudit.__rabbitAuditBuffer = [];
  return globalForAudit.__rabbitAuditBuffer;
}

export function recordAudit(event: AuditEvent): void {
  buffer().push({ ...event, detail: event.detail ?? null, ip: event.ip ?? null });
  if (buffer().length >= 50) void flushAudit();
}

export async function flushAudit(): Promise<void> {
  const events = buffer();
  if (events.length === 0) return;
  globalForAudit.__rabbitAuditBuffer = [];
  try {
    await scheduleQueue().add(AUDIT_QUEUE_NAME, { kind: AUDIT_QUEUE_NAME, events });
  } catch {
    // 降级直写（SYS-008 §2：慢路径保不丢）
    await directWrite(events).catch((e) => console.error("[audit] direct write failed", e));
  }
}

export async function directWrite(events: AuditEvent[]): Promise<void> {
  // INFRA-006：审计为系统级簿记，显式走 admin 通道（免于租户事务关闭后回落/RLS 语义）
  await runAsAdmin(() =>
    prisma.auditLog.createMany({
      data: events.map((e) => ({
        userId: e.userId,
        scope: e.scope,
        projectId: e.projectId ?? null,
        action: e.action.slice(0, 64),
        objectType: e.objectType.slice(0, 64),
        objectId: e.objectId?.slice(0, 64) ?? null,
        detail: (e.detail ?? undefined) as never,
        ip: e.ip?.slice(0, 64) ?? null,
      })),
    }),
  );
}

// ── withAudit 包装器（声明式挂载于写路由）──

interface AuditCtx {
  userId: string;
  email?: string;
  projectId?: string;
  orgId?: string;
}

function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? null;
  return null;
}

/**
 * 写端点审计包装：handler 2xx 后投递审计事件；scope 由上下文推断
 * （projectId→project / orgId→org / 其余→system）。失败请求记 action + error 摘要。
 */
export function withAudit<Ctx extends AuditCtx, Args extends unknown[]>(
  action: string,
  objectType: string,
  detail?: (ctx: Ctx, req: Request, result: unknown) => Record<string, unknown> | undefined,
) {
  return function (handler: (ctx: Ctx, req: Request, ...args: Args) => Promise<NextResponse>) {
    return async (ctx: Ctx, req: Request, ...args: Args): Promise<NextResponse> => {
      let res: NextResponse;
      let result: unknown = null;
      try {
        res = await handler(ctx, req, ...args);
      } catch (err) {
        recordAudit({
          userId: ctx.userId,
          scope: ctx.projectId ? "project" : ctx.orgId ? "org" : "system",
          projectId: ctx.projectId ?? null,
          action,
          objectType,
          objectId: null,
          detail: { error: err instanceof Error ? err.message.slice(0, 128) : "unknown" },
          ip: clientIp(req),
        });
        void flushAudit();
        throw err;
      }
      try {
        const body = (res as unknown as { __auditData?: unknown }).__auditData ?? null;
        result =
          body ??
          (await res
            .clone()
            .json()
            .catch(() => null));
      } catch {
        result = null;
      }
      recordAudit({
        userId: ctx.userId,
        scope: ctx.projectId ? "project" : ctx.orgId ? "org" : "system",
        projectId: ctx.projectId ?? null,
        action,
        objectType,
        objectId: extractObjectId(result),
        detail: detail?.(ctx, req, result),
        ip: clientIp(req),
      });
      void flushAudit();
      return res;
    };
  };
}

function extractObjectId(result: unknown): string | null {
  const data = (result as { data?: { id?: unknown } } | null)?.data;
  const id = data && typeof data === "object" ? (data as { id?: unknown }).id : undefined;
  return typeof id === "string" ? id.slice(0, 64) : null;
}

// ── 查询（三级范围裁剪 + 高级筛选）──

export async function queryAuditLogs(
  query: Query,
  scope:
    | { kind: "system" }
    | { kind: "org"; orgId: string }
    | { kind: "project"; projectId: string },
) {
  if (query.from && query.to && new Date(query.to) < new Date(query.from)) {
    throw new DomainError(ErrCode.AUDIT_QUERY_INVALID, "时间范围非法（to 早于 from）");
  }

  const range =
    query.from && query.to ? new Date(query.to).getTime() - new Date(query.from).getTime() : 0;
  if (Number.isFinite(range) && range > 366 * 24 * 3600 * 1000) {
    throw new DomainError(ErrCode.AUDIT_QUERY_INVALID, "时间范围超限（最长 366 天）");
  }
  let projectIds: string[] | undefined;
  if (scope.kind === "project") projectIds = [scope.projectId];
  if (scope.kind === "org") {
    const projects = await prisma.project.findMany({
      where: { orgId: scope.orgId },
      select: { id: true },
      take: 100,
    });
    projectIds = projects.map((p) => p.id);
  }
  const where = {
    ...(projectIds ? { projectId: { in: projectIds } } : {}),
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.objectType ? { objectType: query.objectType } : {}),
    ...(query.action ? { action: { startsWith: query.action } } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  const list = rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    userName: r.user?.name ?? null,
    scope: r.scope,
    projectId: r.projectId,
    action: r.action,
    objectType: r.objectType,
    objectId: r.objectId,
    detail: r.detail,
    ip: r.ip,
    createdAt: r.createdAt.toISOString(),
  }));
  // keyword 后置过滤（detail JSON 内匹配的进程内近似：当前页内匹配——登记 SYS-008 §4 容量口径）
  const filtered = query.keyword
    ? list.filter((r) =>
        JSON.stringify(r.detail ?? {})
          .toLowerCase()
          .includes(query.keyword!.toLowerCase()),
      )
    : list;
  return { list: filtered, total, page: query.page, pageSize: query.pageSize };
}

// ── 保留清理（每日 03:00 由 instrumentation 注册的 repeatable 触发）──

export async function purgeExpiredAuditLogs(retentionDays: number): Promise<{ purged: number }> {
  if (retentionDays <= 0) return { purged: 0 };
  const before = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);
  let purged = 0;
  for (let i = 0; i < 100; i++) {
    const batch = await prisma.auditLog.findMany({
      where: { createdAt: { lt: before } },
      select: { id: true },
      take: 1000,
    });
    if (batch.length === 0) break;
    await prisma.auditLog.deleteMany({ where: { id: { in: batch.map((b) => b.id) } } });
    purged += batch.length;
  }
  if (purged > 0) {
    await prisma.auditLog.create({
      data: {
        userId: null,
        scope: "system",
        action: "audit.purge",
        objectType: "audit_log",
        detail: { purged, before: before.toISOString() } as never,
      },
    });
  }
  return { purged };
}
