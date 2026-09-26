/** CASE-002/BUG-001：模块树（一表多场景）——增删改拖拽/子树计数/环检测。 */
import { DomainError, ErrCode } from '@rabbit/shared';
import { prisma } from '@rabbit/db';

export async function listModules(projectId: string, scene: string) {
  const nodes = await prisma.moduleNode.findMany({
    where: { projectId, scene },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, parentId: true, name: true, isDefault: true, order: true },
  });
  // 用例计数（case 场景；其它场景计数为 0 由消费方忽略）
  const counts = scene === 'case'
    ? await prisma.functionalCase.groupBy({ by: ['moduleId'], where: { projectId, deletedAt: null }, _count: { _all: true } })
    : scene === 'bug'
      ? await prisma.bug.groupBy({ by: ['moduleId'], where: { projectId, deletedAt: null }, _count: { _all: true } })
      : [];
  const countMap = new Map<string, number>();
  for (const c of counts) if (c.moduleId) countMap.set(c.moduleId, (c._count as { _all: number })._all);
  const childrenOf = new Map<string | null, typeof nodes>();
  for (const n of nodes) {
    const key = n.parentId;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(n);
  }
  const build = (parent: string | null): ModuleNodeDto[] =>
    (childrenOf.get(parent) ?? []).map((n) => {
      const children = build(n.id);
      return {
        id: n.id, parentId: n.parentId, name: n.name, isDefault: n.isDefault, order: n.order,
        caseCount: countMap.get(n.id) ?? 0,
        subtreeCount: (countMap.get(n.id) ?? 0) + children.reduce((s, c) => s + c.subtreeCount, 0),
        children,
      };
    });
  return build(null);
}

export interface ModuleNodeDto {
  id: string;
  parentId: string | null;
  name: string;
  isDefault: boolean;
  order: number;
  caseCount: number;
  subtreeCount: number;
  children: ModuleNodeDto[];
}

export async function createModule(projectId: string, scene: string, input: { name: string; parentId?: string | null }) {
  if (input.parentId) {
    const parent = await prisma.moduleNode.findFirst({
      where: { id: input.parentId, projectId, scene },
      select: { id: true },
    });
    if (!parent) throw new DomainError(ErrCode.MODULE_NOT_FOUND, '父模块不存在');
  }
  const maxOrder = await prisma.moduleNode.findFirst({
    where: { projectId, scene, parentId: input.parentId ?? null },
    orderBy: { order: 'desc' },
    select: { order: true },
  });
  return prisma.moduleNode.create({
    data: { projectId, scene, name: input.name, parentId: input.parentId ?? null, order: (maxOrder?.order ?? -1) + 1 },
    select: { id: true, name: true },
  });
}

export async function renameModule(projectId: string, scene: string, id: string, name: string) {
  const existing = await prisma.moduleNode.findFirst({ where: { id, projectId, scene }, select: { id: true } });
  if (!existing) throw new DomainError(ErrCode.MODULE_NOT_FOUND, '模块不存在');
  return prisma.moduleNode.update({ where: { id }, data: { name }, select: { id: true, name: true } });
}

/** 子树 id 集合（含自身）。 */
export async function subtreeIds(projectId: string, scene: string, id: string): Promise<string[]> {
  const nodes = await prisma.moduleNode.findMany({ where: { projectId, scene }, select: { id: true, parentId: true } });
  const childrenOf = new Map<string | null, string[]>();
  for (const n of nodes) {
    if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, []);
    childrenOf.get(n.parentId)!.push(n.id);
  }
  const out: string[] = [];
  const walk = (nid: string) => {
    out.push(nid);
    for (const c of childrenOf.get(nid) ?? []) walk(c);
  };
  walk(id);
  return out;
}

/** 删除：默认模块不可删；子树节点级联删，其下用例/缺陷上移默认模块。 */
export async function deleteModule(projectId: string, scene: string, id: string) {
  const node = await prisma.moduleNode.findFirst({ where: { id, projectId, scene }, select: { id: true, isDefault: true } });
  if (!node) throw new DomainError(ErrCode.MODULE_NOT_FOUND, '模块不存在');
  if (node.isDefault) throw new DomainError(ErrCode.VALIDATION_FAILED, '默认模块不可删除');
  const ids = await subtreeIds(projectId, scene, id);
  const def = await prisma.moduleNode.findFirst({ where: { projectId, scene, isDefault: true }, select: { id: true } });
  if (!def) throw new DomainError(ErrCode.MODULE_NOT_FOUND, '默认模块缺失');
  await prisma.$transaction(async (tx) => {
    if (scene === 'case') await tx.functionalCase.updateMany({ where: { projectId, moduleId: { in: ids } }, data: { moduleId: def.id } });
    if (scene === 'bug') await tx.bug.updateMany({ where: { projectId, moduleId: { in: ids } }, data: { moduleId: def.id } });
    await tx.moduleNode.deleteMany({ where: { id: { in: ids } } });
  });
  return { moved: true, deletedNodes: ids.length };
}

/** 移动（拖拽）：不可拖入自身或后代（环检测服务端复验）。 */
export async function moveModule(projectId: string, scene: string, id: string, parentId: string | null, order: number) {
  const node = await prisma.moduleNode.findFirst({ where: { id, projectId, scene }, select: { id: true, isDefault: true } });
  if (!node) throw new DomainError(ErrCode.MODULE_NOT_FOUND, '模块不存在');
  if (node.isDefault) throw new DomainError(ErrCode.VALIDATION_FAILED, '默认模块不可移动');
  if (parentId === id) throw new DomainError(ErrCode.VALIDATION_FAILED, '不可移动到自身');
  if (parentId) {
    const sub = await subtreeIds(projectId, scene, id);
    if (sub.includes(parentId)) throw new DomainError(ErrCode.VALIDATION_FAILED, '不可移动到自己的后代节点');
    const parent = await prisma.moduleNode.findFirst({ where: { id: parentId, projectId, scene }, select: { id: true } });
    if (!parent) throw new DomainError(ErrCode.MODULE_NOT_FOUND, '目标父模块不存在');
  }
  await prisma.moduleNode.update({ where: { id }, data: { parentId, order } });
  return { id, parentId, order };
}
