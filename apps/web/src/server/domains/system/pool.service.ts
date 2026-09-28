/** EXEC-002 资源池（公开面）：默认池详情/并发编辑（心跳下发）/节点在线态判定。多池 CRUD=ENTP-006。 */
import {
  DomainError,
  ErrCode,
  config,
  type PoolCreateInput,
  type PoolUpdateInput,
} from "@rabbit/shared";
import { prisma } from "@rabbit/db";

const BEAT_INTERVAL_MS = 10_000;
const OFFLINE_AFTER_BEATS = 3;
/** 契约 v4 引擎版本（心跳版本协商：不一致节点标 UNMATCHED 仅供展示，不下发新类型任务） */
const EXPECTED_ENGINE_VERSION = "0.4.0"; // 与 apps/engine runner/worker.ts VERSION 同步（契约 v4 plan 命令；升版须两端同改）

interface NodeRow {
  nodeId: string;
  version: string;
  slots: number;
  busy?: number;
  ts: number;
}

export async function listPools() {
  const pools = await prisma.resourcePool.findMany({ orderBy: { createdAt: "asc" } });
  return {
    total: pools.length,
    items: pools.map((p) => serializePool(p.nodes as unknown as NodeRow[], p)),
  };
}

export async function getPool(id: string) {
  const pool = await prisma.resourcePool.findUnique({ where: { id } });
  if (!pool) throw new DomainError(ErrCode.POOL_NOT_FOUND, "资源池不存在");
  return serializePool(pool.nodes as unknown as NodeRow[], pool);
}

function serializePool(
  nodes: NodeRow[],
  p: {
    id: string;
    name: string;
    type: string;
    isDefault: boolean;
    maxConcurrency: number;
    status: string;
    lastBeatAt: Date | null;
    updatedAt: Date;
    orgScope?: unknown;
  },
) {
  const now = Date.now();
  const staleCut = now - BEAT_INTERVAL_MS * OFFLINE_AFTER_BEATS * 1000;
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    isDefault: p.isDefault,
    maxConcurrency: p.maxConcurrency,
    status: p.status,
    orgScope: p.orgScope ?? "ALL", // S9 ENTP-006：ALL | [orgId]
    canDelete: !p.isDefault, // 默认池保护（社区版单池语义）；有历史任务的池删除时再校验
    lastBeatAt: p.lastBeatAt?.toISOString() ?? null,
    nodes: nodes.map((n) => ({
      nodeId: n.nodeId,
      version: n.version,
      slots: n.slots,
      busy: n.busy ?? 0,
      lastBeatAt: new Date(n.ts).toISOString(),
      state:
        n.ts < staleCut
          ? "OFFLINE"
          : n.version !== EXPECTED_ENGINE_VERSION
            ? "UNMATCHED"
            : "ONLINE",
    })),
  };
}

export async function updatePool(id: string, input: { maxConcurrency: number }) {
  const pool = await prisma.resourcePool.findUnique({ where: { id } });
  if (!pool) throw new DomainError(ErrCode.POOL_NOT_FOUND, "资源池不存在");
  if (input.maxConcurrency < 2 || input.maxConcurrency > 64)
    throw new DomainError(ErrCode.VALIDATION_FAILED, "最大并发取值 2-64");
  await prisma.resourcePool.update({
    where: { id: pool.id },
    data: { maxConcurrency: input.maxConcurrency },
  });
  return getPool(pool.id);
}

// ── S9 ENTP-006：多池 CRUD（License MULTI_POOL 门控在路由层）──

export async function createPool(input: PoolCreateInput) {
  const dup = await prisma.resourcePool.findFirst({
    where: { name: input.name },
    select: { id: true },
  });
  if (dup) throw new DomainError(ErrCode.POOL_NAME_EXISTS, "资源池名称已存在");
  const created = await prisma.resourcePool.create({
    data: {
      name: input.name,
      type: input.type,
      maxConcurrency: input.maxConcurrency,
      orgScope: input.orgScope as unknown as object,
      isDefault: false,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  return getPool(created.id);
}

export async function updatePoolEntp(id: string, input: PoolUpdateInput) {
  const pool = await prisma.resourcePool.findUnique({ where: { id } });
  if (!pool) throw new DomainError(ErrCode.POOL_NOT_FOUND, "资源池不存在");
  if (input.name && input.name !== pool.name) {
    const dup = await prisma.resourcePool.findFirst({
      where: { name: input.name },
      select: { id: true },
    });
    if (dup) throw new DomainError(ErrCode.POOL_NAME_EXISTS, "资源池名称已存在");
  }
  if (input.status === "DISABLED" && pool.isDefault)
    throw new DomainError(ErrCode.POOL_DEFAULT_UNDISABLEABLE, "默认资源池不可禁用");
  if (input.maxConcurrency !== undefined && (input.maxConcurrency < 2 || input.maxConcurrency > 64))
    throw new DomainError(ErrCode.VALIDATION_FAILED, "最大并发取值 2-64");
  await prisma.resourcePool.update({
    where: { id },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.maxConcurrency !== undefined ? { maxConcurrency: input.maxConcurrency } : {}),
      ...(input.orgScope !== undefined ? { orgScope: input.orgScope as unknown as object } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
  });
  return getPool(id);
}

export async function deletePool(id: string) {
  const pool = await prisma.resourcePool.findUnique({ where: { id } });
  if (!pool) throw new DomainError(ErrCode.POOL_NOT_FOUND, "资源池不存在");
  if (pool.isDefault)
    throw new DomainError(ErrCode.POOL_DEFAULT_UNDELETABLE, "默认资源池不可删除（社区版单池保护）");
  const taskCount = await prisma.execTask.count({ where: { poolId: id } });
  if (taskCount > 0) throw new DomainError(ErrCode.POOL_HAS_TASKS, "资源池存在历史任务，不可删除");
  await prisma.resourcePool.delete({ where: { id } });
  return { id };
}

/** 执行入口池校验（ENTP-006）：存在 + ACTIVE + 应用组织含 orgId。 */
export async function assertPoolExecutable(
  poolId: string | null | undefined,
  orgId: string | null,
): Promise<string | null> {
  if (!poolId || poolId === config.defaultPoolId) return config.defaultPoolId;
  const pool = await prisma.resourcePool.findUnique({ where: { id: poolId } });
  if (!pool) throw new DomainError(ErrCode.POOL_NOT_FOUND, "资源池不存在");
  if (pool.status !== "ACTIVE")
    throw new DomainError(ErrCode.POOL_DISABLED, "资源池已禁用，不可执行");
  const scope = pool.orgScope;
  if (orgId && Array.isArray(scope) && !scope.includes(orgId))
    throw new DomainError(ErrCode.POOL_ORG_NOT_ALLOWED, "资源池未应用到当前组织");
  return pool.id;
}

export const DEFAULT_POOL_ID = config.defaultPoolId;
