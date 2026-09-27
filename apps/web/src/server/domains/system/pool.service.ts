/** EXEC-002 资源池（公开面）：默认池详情/并发编辑（心跳下发）/节点在线态判定。新建删除=ENTP-006 不提供端点。 */
import { DomainError, ErrCode, config } from "@rabbit/shared";
import { prisma } from "@rabbit/db";

const BEAT_INTERVAL_MS = 10_000;
const OFFLINE_AFTER_BEATS = 3;
/** 契约 v2 引擎版本（心跳版本协商：不一致节点标 UNMATCHED 仅供展示，不下发新类型任务） */
const EXPECTED_ENGINE_VERSION = "0.2.0";

interface NodeRow {
  nodeId: string;
  version: string;
  slots: number;
  busy?: number;
  ts: number;
}

export async function listPools() {
  const pools = await prisma.resourcePool.findMany({ orderBy: { createdAt: "asc" } });
  return { total: pools.length, items: pools.map((p) => serializePool(p.nodes as unknown as NodeRow[], p)) };
}

export async function getPool(id: string) {
  const pool = await prisma.resourcePool.findUnique({ where: { id } });
  if (!pool) throw new DomainError(ErrCode.POOL_NOT_FOUND, "资源池不存在");
  return serializePool(pool.nodes as unknown as NodeRow[], pool);
}

function serializePool(nodes: NodeRow[], p: {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
  maxConcurrency: number;
  status: string;
  lastBeatAt: Date | null;
  updatedAt: Date;
}) {
  const now = Date.now();
  const staleCut = now - BEAT_INTERVAL_MS * OFFLINE_AFTER_BEATS * 1000;
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    isDefault: p.isDefault,
    maxConcurrency: p.maxConcurrency,
    status: p.status,
    canDelete: false, // 标准版单默认池不可删（License 门控 ENTP-006）
    lastBeatAt: p.lastBeatAt?.toISOString() ?? null,
    nodes: nodes.map((n) => ({
      nodeId: n.nodeId,
      version: n.version,
      slots: n.slots,
      busy: n.busy ?? 0,
      lastBeatAt: new Date(n.ts).toISOString(),
      state:
        n.ts < staleCut ? "OFFLINE" : n.version !== EXPECTED_ENGINE_VERSION ? "UNMATCHED" : "ONLINE",
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

export const DEFAULT_POOL_ID = config.defaultPoolId;
