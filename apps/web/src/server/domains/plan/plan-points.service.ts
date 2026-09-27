/** S4 PLAN-002 测试规划：测试点树 CRUD/重排/挂载移动（TestPoint 预建模型，零迁移）。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import type { PointUpsert } from "@rabbit/shared";
import { prisma } from "@rabbit/db";

async function loadPlan(projectId: string, planId: string) {
  const p = await prisma.testPlan.findFirst({
    where: { id: planId, projectId, deletedAt: null },
    select: { id: true, archivedAt: true, type: true },
  });
  if (!p) throw new DomainError(ErrCode.PLAN_NOT_FOUND, "计划不存在或已删除");
  if (p.type === "GROUP") throw new DomainError(ErrCode.GROUP_NOT_EXECUTABLE, "计划组不支持测试点");
  return p;
}

function requireNotArchived(archivedAt: Date | null) {
  if (archivedAt) throw new DomainError(ErrCode.PLAN_ARCHIVED, "计划已归档，只读");
}

/** parent 不能指向自身或后代（POINT_CYCLE）。 */
async function assertParentOk(planId: string, pointId: string | null, parentId: string | null | undefined) {
  if (parentId === undefined || parentId === null) return;
  if (pointId && parentId === pointId)
    throw new DomainError(ErrCode.POINT_CYCLE, "父测试点不能是自身");
  const points = await prisma.testPoint.findMany({
    where: { planId },
    select: { id: true, parentId: true },
  });
  const byId = new Map(points.map((p) => [p.id, p]));
  if (!byId.has(parentId)) throw new DomainError(ErrCode.POINT_NOT_FOUND, "父测试点不存在");
  // 沿 parent 链向上查是否回到 pointId（后代环）
  let cur = byId.get(parentId);
  const seen = new Set<string>();
  while (cur && cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.parentId === pointId)
      throw new DomainError(ErrCode.POINT_CYCLE, "父测试点不能指向后代测试点");
    cur = byId.get(cur.parentId);
  }
}

export async function listPoints(projectId: string, planId: string) {
  await loadPlan(projectId, planId);
  const [points, refStats] = await Promise.all([
    prisma.testPoint.findMany({ where: { planId }, orderBy: [{ order: "asc" }, { id: "asc" }] }),
    prisma.planCaseRef.groupBy({
      by: ["pointId", "refType"],
      where: { planId },
      _count: { _all: true },
    }),
  ]);
  const counts = new Map<string, { functional_case: number; api_case: number; scenario: number }>();
  for (const g of refStats) {
    const key = g.pointId ?? "__ungrouped__";
    const entry = counts.get(key) ?? { functional_case: 0, api_case: 0, scenario: 0 };
    if (g.refType === "functional_case" || g.refType === "api_case" || g.refType === "scenario") {
      entry[g.refType] += g._count._all;
    }
    counts.set(key, entry);
  }
  interface PointNode {
    id: string;
    parentId: string | null;
    name: string;
    inheritConfig: boolean;
    config: Record<string, unknown>;
    order: number;
    counts: { functional_case: number; api_case: number; scenario: number };
    children: PointNode[];
  }
  const toNode = (p: (typeof points)[number]): PointNode => ({
    id: p.id,
    parentId: p.parentId,
    name: p.name,
    inheritConfig: p.inheritConfig,
    config: (p.config ?? {}) as Record<string, unknown>,
    order: p.order,
    counts: counts.get(p.id) ?? { functional_case: 0, api_case: 0, scenario: 0 },
    children: [] as ReturnType<typeof toNode>[],
  });
  const nodes = points.map(toNode);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots: ReturnType<typeof toNode>[] = [];
  for (const n of nodes) {
    if (n.parentId && byId.has(n.parentId)) byId.get(n.parentId)!.children.push(n);
    else roots.push(n);
  }
  return { points: roots, ungrouped: counts.get("__ungrouped__") ?? { functional_case: 0, api_case: 0, scenario: 0 } };
}

export async function createPoint(projectId: string, planId: string, input: PointUpsert) {
  const p = await loadPlan(projectId, planId);
  requireNotArchived(p.archivedAt);
  await assertParentOk(planId, null, input.parentId);
  const maxOrder = await prisma.testPoint.aggregate({
    where: { planId, parentId: input.parentId ?? null },
    _max: { order: true },
  });
  return prisma.testPoint.create({
    data: {
      planId,
      name: input.name,
      parentId: input.parentId ?? null,
      inheritConfig: input.inheritConfig ?? true,
      config: (input.config ?? {}) as object,
      order: input.order ?? (maxOrder._max.order ?? -1) + 1,
    },
    select: { id: true, name: true },
  });
}

export async function updatePoint(projectId: string, planId: string, pointId: string, input: Partial<PointUpsert>) {
  const p = await loadPlan(projectId, planId);
  requireNotArchived(p.archivedAt);
  const point = await prisma.testPoint.findFirst({ where: { id: pointId, planId } });
  if (!point) throw new DomainError(ErrCode.POINT_NOT_FOUND, "测试点不存在");
  await assertParentOk(planId, pointId, input.parentId);
  await prisma.testPoint.update({
    where: { id: pointId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.inheritConfig !== undefined ? { inheritConfig: input.inheritConfig } : {}),
      ...(input.config !== undefined ? { config: input.config as object } : {}),
      ...(input.order !== undefined ? { order: input.order } : {}),
    },
  });
  return { id: pointId };
}

export async function deletePoint(projectId: string, planId: string, pointId: string) {
  const p = await loadPlan(projectId, planId);
  requireNotArchived(p.archivedAt);
  const point = await prisma.testPoint.findFirst({ where: { id: pointId, planId } });
  if (!point) throw new DomainError(ErrCode.POINT_NOT_FOUND, "测试点不存在");
  const [childCount, refCount] = await Promise.all([
    prisma.testPoint.count({ where: { parentId: pointId } }),
    prisma.planCaseRef.count({ where: { pointId } }),
  ]);
  if (childCount > 0 || refCount > 0)
    throw new DomainError(ErrCode.POINT_NOT_EMPTY, `测试点下还有 ${refCount} 条用例或 ${childCount} 个子点，请先清空`);
  await prisma.testPoint.delete({ where: { id: pointId } });
  return { ok: true };
}

/** 同级批量重排（orderedIds 为同级完整序；非同级的 id 忽略）。 */
export async function reorderPoints(projectId: string, planId: string, orderedIds: string[]) {
  const p = await loadPlan(projectId, planId);
  requireNotArchived(p.archivedAt);
  const points = await prisma.testPoint.findMany({ where: { planId, id: { in: orderedIds } } });
  const byId = new Map(points.map((pt) => [pt.id, pt]));
  const parentIdSet = new Set(points.map((pt) => pt.parentId));
  if (parentIdSet.size > 1)
    throw new DomainError(ErrCode.VALIDATION_FAILED, "orderedIds 必须为同一父级下的测试点");
  await prisma.$transaction(
    orderedIds.map((id, i) => {
      if (!byId.has(id)) throw new DomainError(ErrCode.POINT_NOT_FOUND, `测试点不存在：${id}`);
      return prisma.testPoint.update({ where: { id }, data: { order: i } });
    }),
  );
  return { ok: true };
}

/** 批量移动挂载（保留执行状态与历史）。 */
export async function movePlanCases(projectId: string, planId: string, refIds: string[], pointId: string | null) {
  const p = await loadPlan(projectId, planId);
  requireNotArchived(p.archivedAt);
  if (pointId) {
    const point = await prisma.testPoint.findFirst({ where: { id: pointId, planId } });
    if (!point) throw new DomainError(ErrCode.POINT_NOT_FOUND, "测试点不存在");
  }
  const r = await prisma.planCaseRef.updateMany({ where: { id: { in: refIds }, planId }, data: { pointId } });
  return { affected: r.count };
}
