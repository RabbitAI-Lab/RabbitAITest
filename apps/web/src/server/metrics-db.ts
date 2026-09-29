/**
 * INFRA-007：DB 慢查询计量（/system/metrics 数据源；rules/observability §6「DB 慢查询计数」）。
 * Prisma admin 客户端 query 事件（packages/db 构造处启用 emit:'event'）→ 阈值过滤计数。
 * 只计数、不落 SQL 文本与参数（rules/observability §3 脱敏口径）；
 * 阈值 RABBIT_SLOW_QUERY_MS（默认 200ms；0=不订阅——逃生门）。
 */
import { prisma } from "@rabbit/db";

const globalForSlow = globalThis as unknown as {
  __rabbitSlowQueries?: number;
  __rabbitSlowQueryInit?: boolean;
};

/** prisma 导出类型为默认 PrismaClient——$on 事件重载需构造期 log 配置类型，按运行时形状结构化收窄。 */
type PrismaWithQueryEvent = {
  $on: (event: "query", listener: (e: { duration: number }) => void) => void;
};

export function slowQueryThresholdMs(): number {
  const n = Number(process.env.RABBIT_SLOW_QUERY_MS ?? 200);
  return Number.isFinite(n) && n >= 0 ? n : 200;
}

/** 进程级一次（globalThis 防重；guard 模块加载时调用）；阈值 0 时跳过订阅。 */
export function initSlowQueryMeter(): void {
  if (globalForSlow.__rabbitSlowQueryInit) return;
  globalForSlow.__rabbitSlowQueryInit = true;
  const t = slowQueryThresholdMs();
  if (t === 0) return;
  (prisma as unknown as PrismaWithQueryEvent).$on("query", (e) => {
    if (e.duration >= t)
      globalForSlow.__rabbitSlowQueries = (globalForSlow.__rabbitSlowQueries ?? 0) + 1;
  });
}

export function slowQueryCount(): number {
  return globalForSlow.__rabbitSlowQueries ?? 0;
}
