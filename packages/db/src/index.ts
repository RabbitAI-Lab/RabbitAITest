import { PrismaClient } from '@prisma/client';

/** 全仓唯一 PrismaClient 出口（rules/database §1.2：仅 apps/web/src/server 使用）。 */
export const prisma = new PrismaClient();

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
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', table, projectId);
  const rows = (await tx.$queryRawUnsafe(
    `SELECT COALESCE(MAX(num), 0) + 1 AS n FROM "${table}" WHERE project_id = $1`,
    projectId,
  )) as { n: bigint | number }[];
  const first = rows[0];
  if (!first) throw new Error('nextNum: no result');
  return Number(first.n);
}

export { Prisma } from '@prisma/client';
export * from './presets';
export type * from '@prisma/client';
