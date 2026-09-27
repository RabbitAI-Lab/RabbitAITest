/** S4 CASE-007：脑图批量保存——模块批（建/改名/删）+ 用例批（建/改/删，乐观锁）一次提交。
 * 事务内按序执行；任一步失败整体回滚（前端保留本地树可重试）。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import type { MindmapSave } from "@rabbit/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "@rabbit/db";

const MAX_NODES = 500;

export async function saveMindmap(
  projectId: string,
  orgId: string,
  userId: string,
  input: MindmapSave,
) {
  const nodeCount =
    input.modules.created.length +
    input.modules.renamed.length +
    input.modules.deleted.length +
    input.cases.created.length +
    input.cases.updated.length +
    input.cases.deleted.length;
  if (nodeCount > MAX_NODES)
    throw new DomainError(ErrCode.MINDMAP_TOO_LARGE, `脑图变更节点数超上限（${MAX_NODES}）`);

  // 前置校验：模块归属/存在性
  const moduleIds = [
    ...input.modules.created.map((m) => m.parentId).filter((p): p is string => Boolean(p)),
    ...input.modules.renamed.map((m) => m.id),
    ...input.modules.deleted,
    ...input.cases.created.map((c) => c.moduleId).filter((m): m is string => Boolean(m)),
    ...input.cases.updated.flatMap((c) => (c.moduleId ? [c.moduleId] : [])),
  ];
  const modules = await prisma.moduleNode.findMany({
    where: { id: { in: moduleIds }, projectId, scene: "case" },
    select: { id: true, name: true, parentId: true, isDefault: true },
  });
  const moduleSet = new Set(modules.map((m) => m.id));

  const idMap: Record<string, string> = {};
  const conflicts: { id: string; reason: string }[] = [];

  await prisma.$transaction(async (tx) => {
    // 1) 模块：建（tmpId → idMap）
    for (const m of input.modules.created) {
      if (m.parentId && !moduleSet.has(m.parentId))
        throw new DomainError(ErrCode.MODULE_NOT_FOUND, `父模块不存在：${m.parentId}`);
      const maxOrder = await tx.moduleNode.aggregate({
        where: { projectId, scene: "case", parentId: m.parentId ?? null },
        _max: { order: true },
      });
      const created = await tx.moduleNode.create({
        data: {
          projectId,
          scene: "case",
          name: m.name,
          parentId: m.parentId ?? null,
          order: (maxOrder._max.order ?? -1) + 1,
          isDefault: false,
        },
        select: { id: true },
      });
      idMap[m.tmpId] = created.id;
      moduleSet.add(created.id);
    }
    // 2) 模块：改名
    for (const m of input.modules.renamed) {
      if (!moduleSet.has(m.id))
        throw new DomainError(ErrCode.MODULE_NOT_FOUND, `模块不存在：${m.id}`);
      await tx.moduleNode.update({ where: { id: m.id }, data: { name: m.name } });
    }
    // 3) 模块：删（校验空：无子模块且无用例；默认模块不可删）
    for (const id of input.modules.deleted) {
      const mod = modules.find((m) => m.id === id);
      if (mod?.isDefault) throw new DomainError(ErrCode.VALIDATION_FAILED, "默认模块不可删除");
      const [childCount, caseCount] = await Promise.all([
        tx.moduleNode.count({ where: { parentId: id } }),
        tx.functionalCase.count({ where: { moduleId: id, deletedAt: null } }),
      ]);
      if (childCount > 0 || caseCount > 0)
        throw new DomainError(ErrCode.VALIDATION_FAILED, `模块「${mod?.name ?? id}」非空，不能删除`);
      await tx.moduleNode.delete({ where: { id } });
    }
    // 4) 用例：建（步骤/等级/前置；模块=tmpId 映射或直接 id；缺省回落默认模块——同 createCaseV2 口径）
    for (const c of input.cases.created) {
      let moduleId = c.moduleId
        ? (moduleSet.has(c.moduleId) ? c.moduleId : (idMap[c.moduleId] ?? null))
        : null;
      if (!moduleId) {
        const def = await tx.moduleNode.findFirst({
          where: { projectId, scene: "case", isDefault: true },
          select: { id: true },
        });
        moduleId = def?.id ?? null;
        if (moduleId) moduleSet.add(moduleId);
      }
      const created = await tx.functionalCase.create({
        data: {
          projectId,
          num: (await tx.functionalCase.count({ where: { projectId } })) + 1,
          name: c.name,
          precondition: c.precondition,
          steps: c.steps as object,
          level: c.level,
          tags: [],
          moduleId: moduleId ?? "",
          status: "",
          version: 1,
          createdBy: userId,
        },
        select: { id: true },
      });
      idMap[c.tmpId] = created.id;
    }
    // 5) 用例：改（乐观锁 version；冲突收集不中断——整体仍提交成功部分）
    for (const c of input.cases.updated) {
      const existing = await tx.functionalCase.findFirst({
        where: { id: c.id, projectId, deletedAt: null },
        select: { id: true, version: true, name: true, level: true, precondition: true, steps: true, moduleId: true },
      });
      if (!existing) throw new DomainError(ErrCode.CASE_NOT_FOUND, `用例不存在：${c.id}`);
      if (existing.version !== c.version) {
        conflicts.push({ id: c.id, reason: "版本冲突（他人已修改）" });
        continue;
      }
      const beforeSteps = (existing.steps ?? []) as { desc: string; expect: string }[];
      const afterSteps = c.steps ?? beforeSteps;
      const fieldChanges: { key: string; from: unknown; to: unknown }[] = [];
      if (c.name !== undefined && c.name !== existing.name)
        fieldChanges.push({ key: "name", from: existing.name, to: c.name });
      if (c.level !== undefined && c.level !== existing.level)
        fieldChanges.push({ key: "level", from: existing.level, to: c.level });
      if (c.precondition !== undefined && c.precondition !== existing.precondition)
        fieldChanges.push({ key: "precondition", from: existing.precondition, to: c.precondition });
      let stepsPart: { added: number; removed: number; changed: number } | undefined;
      if (JSON.stringify(beforeSteps) !== JSON.stringify(afterSteps)) {
        const keyOf = (s: { desc: string; expect: string }) => `${s.desc}\u0000${s.expect}`;
        const bMap = new Map(beforeSteps.map((s, i) => [keyOf(s), i]));
        const aMap = new Map(afterSteps.map((s, i) => [keyOf(s), i]));
        stepsPart = {
          added: afterSteps.filter((s) => !bMap.has(keyOf(s))).length,
          removed: beforeSteps.filter((s) => !aMap.has(keyOf(s))).length,
          changed: afterSteps.filter((s, i) => bMap.has(keyOf(s)) && bMap.get(keyOf(s)) !== i).length,
        };
      }
      const updateData: {
        name?: string;
        level?: string;
        precondition?: string;
        steps?: object;
        moduleId?: string;
        version: { increment: number };
      } = { version: { increment: 1 } };
      if (c.name !== undefined) updateData.name = c.name;
      if (c.level !== undefined) updateData.level = c.level;
      if (c.precondition !== undefined) updateData.precondition = c.precondition;
      if (c.steps !== undefined) updateData.steps = c.steps as object;
      if (c.moduleId !== undefined) {
        // moduleId 非空列：null=回落默认模块（同列表移动口径）
        let target = c.moduleId ? (moduleSet.has(c.moduleId) ? c.moduleId : (idMap[c.moduleId] ?? null)) : null;
        if (!target) {
          const def = await tx.moduleNode.findFirst({
            where: { projectId, scene: "case", isDefault: true },
            select: { id: true },
          });
          target = def?.id ?? null;
        }
        if (target) updateData.moduleId = target;
      }
      await tx.functionalCase.update({
        where: { id: c.id },
        data: updateData as Prisma.FunctionalCaseUncheckedUpdateInput,
      });
      await tx.changeLog.create({
        data: {
          entityType: "functional_case",
          entityId: c.id,
          seq: existing.version + 1,
          action: "update",
          userId,
          diff: JSON.parse(
            JSON.stringify({
              partitions: {
                ...(fieldChanges.length > 0 ? { fields: fieldChanges } : {}),
                ...(stepsPart ? { steps: stepsPart } : {}),
              },
              source: "mindmap",
            }),
          ) as object,
        },
      });
    }
    // 6) 用例：删（软删入回收站——列表口径一致）
    for (const id of input.cases.deleted) {
      const r = await tx.functionalCase.updateMany({
        where: { id, projectId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (r.count === 0) throw new DomainError(ErrCode.CASE_NOT_FOUND, `用例不存在：${id}`);
    }
  });

  return {
    idMap,
    conflicts,
    saved: {
      modulesCreated: input.modules.created.length,
      modulesRenamed: input.modules.renamed.length,
      modulesDeleted: input.modules.deleted.length,
      casesCreated: input.cases.created.length,
      casesUpdated: input.cases.updated.length - conflicts.length,
      casesDeleted: input.cases.deleted.length,
    },
  };
}
