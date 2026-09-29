import {
  prismaFacade,
  runAsAdmin,
  runWithTenantContext,
  tenantRuntimeStatus,
  prismaAdmin,
  currentTenantContext,
  ensureTenantRuntime,
} from "./tenant";

/**
 * 全仓唯一 PrismaClient 出口（rules/database §1.2：仅 apps/web/src/server 使用）。
 * INFRA-006 起 `prisma` 为 RLS 门面：组织/项目作用域（guard → runWithTenantContext）
 * 内的路由进 rabbit_tenant 事务（行级安全过滤），其余直连 admin（owner，行为同历史）。
 * 服务层导入面与类型（PrismaClient）不变；admin 客户端经 globalThis 缓存防 Next 多
 * chunk 多连接池（见 tenant.ts）。
 * INFRA-007：query 事件在 tenant.ts 的 admin 构造处启用（apps/web metrics-db 慢查询计量订阅；
 * RABBIT_SLOW_QUERY_MS=0 可关闭——事件仅在有订阅消费时产生开销）。
 */
export const prisma = prismaFacade;

export {
  runWithTenantContext,
  runAsAdmin,
  tenantRuntimeStatus,
  currentTenantContext,
  ensureTenantRuntime,
  prismaAdmin,
};

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
