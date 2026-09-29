import { PrismaClient } from "@prisma/client";

/**
 * 全仓唯一 PrismaClient 出口（rules/database §1.2：仅 apps/web/src/server 使用）。
 * globalThis 缓存：Next 生产构建按 chunk 实例化模块，不加缓存时每个 chunk 各建
 * 一个连接池，111 路由规模下连接数爆掉 embedded PG 的 max_connections（P2037）。
 */
const g = globalThis as unknown as { __rabbitPrisma?: PrismaClient };
/**
 * INFRA-007：启用 query 事件（apps/web metrics-db 慢查询计量订阅；warn/error 保持 stdout 不变；
 * 订阅侧可用 RABBIT_SLOW_QUERY_MS=0 关闭——事件仅在有订阅消费时产生开销）。
 */
export const prisma =
  g.__rabbitPrisma ??
  new PrismaClient({
    log: [
      { level: "query", emit: "event" },
      { level: "warn", emit: "stdout" },
      { level: "error", emit: "stdout" },
    ],
  });
g.__rabbitPrisma = prisma;

/**
 * 项目内自增编号（rules/database §5.7）：
 * 事务内 advisory lock(hashtext(table), projectId) → max(num)+1。
 */
export async function nextNum(
  tx: {
    $queryRawUnsafe: (q: string, ...p: unknown[]) => Promise<unknown[]>;
    $executeRawUnsafe: (q: string, ...p: unknown[]) => Promise<number>;
  },
  table: string,
  projectId: string,
): Promise<number> {
  await tx.$executeRawUnsafe(
    "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
    table,
    projectId,
  );
  const rows = (await tx.$queryRawUnsafe(
    `SELECT COALESCE(MAX(num), 0) + 1 AS n FROM "${table}" WHERE project_id = $1`,
    projectId,
  )) as { n: bigint | number }[];
  const first = rows[0];
  if (!first) throw new Error("nextNum: no result");
  return Number(first.n);
}

export { Prisma } from "@prisma/client";
export * from "./presets";
export type * from "@prisma/client";
