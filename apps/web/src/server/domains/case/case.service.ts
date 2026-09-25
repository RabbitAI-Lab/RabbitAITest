import { DomainError, ErrCode } from '@rabbit/shared';
import type { CaseCreateInput, CaseListQuery, CaseStep } from '@rabbit/shared';
import { prisma } from '@rabbit/db';

const CHANGE_FIELDS = ['name', 'precondition', 'steps', 'level', 'tags'] as const;

export async function createCase(projectId: string, userId: string, input: CaseCreateInput) {
  return prisma.$transaction(async (tx) => {
    const module = await tx.moduleNode.findFirst({
      where: { projectId, scene: 'case', isDefault: true },
      select: { id: true },
    });
    if (!module) throw new DomainError(20404, '默认模块缺失，请重新初始化项目');
    const { nextNum } = await import('@rabbit/db');
    const num = await nextNum(tx, 'functional_cases', projectId);
    const created = await tx.functionalCase.create({
      data: {
        projectId, moduleId: module.id, num,
        name: input.name, precondition: input.precondition,
        steps: input.steps, level: input.level, tags: input.tags,
        createdBy: userId,
      },
      select: { id: true, num: true },
    });
    await tx.changeLog.create({
      data: {
        entityType: 'functional_case', entityId: created.id, seq: 1,
        action: 'create', userId,
        diff: { after: { name: input.name, level: input.level } },
      },
    });
    return created;
  });
}

export async function listCases(projectId: string, q: CaseListQuery) {
  const where = {
    projectId,
    deletedAt: q.recycled ? { not: null } : null,
    ...(q.keyword ? { name: { contains: q.keyword, mode: 'insensitive' as const } } : {}),
    ...(q.level ? { level: q.level } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.functionalCase.count({ where }),
    prisma.functionalCase.findMany({
      where,
      orderBy: q.orderBy === 'num'
        ? { num: q.order } : { updatedAt: q.order },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: caseSelect,
    }),
  ]);
  return { total, items: items.map(serialize) };
}

const caseSelect = {
  id: true, num: true, name: true, precondition: true, steps: true, level: true,
  tags: true, version: true, deletedAt: true, createdAt: true, updatedAt: true,
} as const;

function serialize(c: {
  id: string; num: number; name: string; precondition: string;
  steps: unknown; level: string; tags: unknown; version: number;
  deletedAt: Date | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    ...c,
    steps: (c.steps ?? []) as CaseStep[],
    tags: (c.tags ?? []) as string[],
    deletedAt: c.deletedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function getCase(projectId: string, caseId: string) {
  const c = await prisma.functionalCase.findFirst({
    where: { id: caseId, projectId, deletedAt: null },
    select: caseSelect,
  });
  if (!c) throw new DomainError(30404, '用例不存在或已删除');
  return serialize(c);
}

export async function updateCase(projectId: string, caseId: string, userId: string, input: CaseCreateInput & { version: number }) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.functionalCase.findFirst({
      where: { id: caseId, projectId, deletedAt: null },
      select: { id: true, version: true, name: true, level: true, precondition: true },
    });
    if (!existing) throw new DomainError(30404, '用例不存在或已删除');
    if (existing.version !== input.version) {
      throw new DomainError(ErrCode.VERSION_CONFLICT, '内容已被他人修改，请刷新后重试');
    }
    const updated = await tx.functionalCase.update({
      where: { id: caseId },
      data: {
        name: input.name, precondition: input.precondition,
        steps: input.steps, level: input.level, tags: input.tags,
        version: { increment: 1 },
      },
      select: caseSelect,
    });
    const diff: Record<string, { before: unknown; after: unknown }> = {};
    const before: Record<string, unknown> = {
      name: existing.name, level: existing.level, precondition: existing.precondition,
    };
    const after: Record<string, unknown> = {
      name: input.name, level: input.level, precondition: input.precondition,
    };
    for (const f of CHANGE_FIELDS) {
      if (before[f] !== undefined && before[f] !== after[f]) diff[f] = { before: before[f], after: after[f] };
    }
    await tx.changeLog.create({
      data: {
        entityType: 'functional_case', entityId: caseId, seq: updated.version,
        action: 'update', userId,
        diff: JSON.parse(JSON.stringify(diff)) as object,
      },
    });
    return serialize(updated);
  });
}

export async function softDeleteCase(projectId: string, caseId: string, userId: string) {
  const r = await prisma.functionalCase.updateMany({
    where: { id: caseId, projectId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (r.count === 0) throw new DomainError(30404, '用例不存在或已在回收站');
  await prisma.changeLog.create({
    data: { entityType: 'functional_case', entityId: caseId, seq: 0, action: 'delete', userId },
  }).catch(() => undefined);
}

export async function restoreCase(projectId: string, caseId: string) {
  const r = await prisma.functionalCase.updateMany({
    where: { id: caseId, projectId, deletedAt: { not: null } },
    data: { deletedAt: null },
  });
  if (r.count === 0) throw new DomainError(30404, '用例不在回收站');
}

export async function purgeCase(projectId: string, caseId: string) {
  const c = await prisma.functionalCase.findFirst({
    where: { id: caseId, projectId, deletedAt: { not: null } },
    select: { id: true },
  });
  if (!c) throw new DomainError(30404, '用例不在回收站');
  await prisma.functionalCase.delete({ where: { id: caseId } }); // 横切表 Cascade
}
