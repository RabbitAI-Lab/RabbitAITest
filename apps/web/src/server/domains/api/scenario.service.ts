/** API-006 场景：CRUD/步骤树整存/回收站/复制/批量操作/执行历史/变更历史。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import type { z } from "zod";
import type { ScenarioStepNode } from "@rabbit/shared/execution";
import {
  scenarioListQuerySchema,
  scenarioSaveSchema,
  scenarioStepsSaveSchema,
  scenarioBatchOpSchema,
} from "@rabbit/shared";
import { nextNum, prisma } from "@rabbit/db";

type SaveInput = z.infer<typeof scenarioSaveSchema>;
type ListQuery = z.infer<typeof scenarioListQuerySchema>;
type StepsInput = z.infer<typeof scenarioStepsSaveSchema>;
type BatchInput = z.infer<typeof scenarioBatchOpSchema>;

async function getScenario(projectId: string, id: string, includeDeleted = false) {
  const s = await prisma.scenario.findFirst({
    where: { id, projectId, ...(includeDeleted ? {} : { deletedAt: null }) },
  });
  if (!s) throw new DomainError(ErrCode.SCENARIO_NOT_FOUND, "场景不存在或已删除");
  return s;
}

async function appendChangeLog(entityId: string, action: string, diff: unknown, userId: string) {
  await prisma.changeLog.create({
    data: {
      entityType: "scenario",
      entityId,
      action,
      diff: diff as object,
      userId,
      seq: (await prisma.changeLog.count({ where: { entityType: "scenario", entityId } })) + 1,
    },
  });
}

export async function listScenarios(projectId: string, query: ListQuery) {
  // 模块子树展开（includeChildren）
  let moduleIds: string[] | undefined;
  if (query.moduleId) {
    const all = await prisma.moduleNode.findMany({
      where: { projectId, scene: "scenario" },
      select: { id: true, parentId: true },
    });
    const want = new Set<string>([query.moduleId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of all)
        if (n.parentId && want.has(n.parentId) && !want.has(n.id)) {
          want.add(n.id);
          grew = true;
        }
    }
    moduleIds = [...want];
  }
  const where = {
    projectId,
    deletedAt: query.recycle ? { not: null } : null,
    ...(moduleIds ? { moduleId: { in: moduleIds } } : {}),
    ...(query.keyword
      ? {
          OR: [
            { name: { contains: query.keyword, mode: "insensitive" as const } },
            { num: Number(query.keyword) || -1 },
          ],
        }
      : {}),
    ...(query.level ? { level: query.level } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.tag ? { tags: { array_contains: [query.tag] } } : {}),
  };
  const total = await prisma.scenario.count({ where });
  const rows = await prisma.scenario.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
    select: {
      id: true,
      num: true,
      name: true,
      level: true,
      status: true,
      tags: true,
      moduleId: true,
      version: true,
      deletedAt: true,
      createdBy: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { steps: true } },
    },
  });
  // 最近执行（ExecItem refType=scenario）
  const ids = rows.map((r) => r.id);
  const items = await prisma.execItem.findMany({
    where: { refType: "scenario", refId: { in: ids } },
    select: { refId: true, status: true, finishedAt: true },
    orderBy: { finishedAt: "desc" },
  });
  const latest = new Map<string, { status: string; finishedAt: Date | null }>();
  for (const it of items)
    if (!latest.has(it.refId))
      latest.set(it.refId, { status: it.status, finishedAt: it.finishedAt });
  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    items: rows.map((r) => ({
      id: r.id,
      num: r.num,
      name: r.name,
      level: r.level,
      status: r.status,
      tags: (r.tags as string[]) ?? [],
      moduleId: r.moduleId,
      version: r.version,
      stepCount: r._count.steps,
      lastRun: latest.get(r.id) ?? null,
      deletedAt: r.deletedAt?.toISOString() ?? null,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

export async function getScenarioDetail(projectId: string, id: string) {
  const s = await getScenario(projectId, id, true);
  const steps = await prisma.scenarioStep.findMany({
    where: { scenarioId: id },
    orderBy: { order: "asc" },
  });
  const byParent = new Map<string | null, typeof steps>();
  for (const st of steps) {
    const key = st.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(st);
  }
  const build = (parent: string | null): ScenarioStepNode[] =>
    (byParent.get(parent) ?? []).map((st) => {
      const node: ScenarioStepNode = {
        uid: st.id,
        stepType: st.stepType as ScenarioStepNode["stepType"],
        name: st.name,
        enabled: st.enabled,
        config: (st.config as Record<string, unknown>) ?? {},
        children: build(st.id),
      };
      return node;
    });
  return {
    id: s.id,
    num: s.num,
    name: s.name,
    level: s.level,
    status: s.status,
    tags: (s.tags as string[]) ?? [],
    moduleId: s.moduleId,
    version: s.version,
    config: s.config,
    deletedAt: s.deletedAt?.toISOString() ?? null,
    stepCount: steps.length,
    steps: build(null),
    createdBy: s.createdBy,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function createScenario(projectId: string, userId: string, input: SaveInput) {
  const num = await nextNum(prisma, "scenarios", projectId);
  const s = await prisma.scenario.create({
    data: {
      projectId,
      moduleId: input.moduleId,
      num,
      name: input.name,
      level: input.level,
      status: input.status,
      tags: input.tags,
      config: input.config as object,
      createdBy: userId,
    },
  });
  await appendChangeLog(s.id, "create", { name: input.name }, userId);
  return { id: s.id, num: s.num };
}

export async function updateScenario(
  projectId: string,
  userId: string,
  id: string,
  input: SaveInput,
) {
  const s = await getScenario(projectId, id);
  if (s.version !== input.version)
    throw new DomainError(ErrCode.VERSION_CONFLICT, "场景已被他人修改，请刷新后重试");
  const before = { name: s.name, level: s.level, config: s.config };
  await prisma.scenario.update({
    where: { id },
    data: {
      name: input.name,
      moduleId: input.moduleId,
      level: input.level,
      status: input.status,
      tags: input.tags,
      config: input.config as object,
      version: s.version + 1,
    },
  });
  await appendChangeLog(
    id,
    "update",
    {
      name: before.name !== input.name ? `${before.name} → ${input.name}` : undefined,
      config:
        JSON.stringify(before.config) !== JSON.stringify(input.config) ? "配置区变更" : undefined,
    },
    userId,
  );
  return { id, version: s.version + 1 };
}

/** 步骤树整存（全删重建；version 乐观锁）。uid=前端稳定键直接作为 ScenarioStep.id。 */
export async function saveSteps(projectId: string, userId: string, id: string, input: StepsInput) {
  const s = await getScenario(projectId, id);
  if (s.version !== input.version)
    throw new DomainError(ErrCode.VERSION_CONFLICT, "场景已被他人修改，请刷新后重试");
  // 循环引用检测（ref_scenario 深度≤5）
  await assertNoCircularRef(projectId, id, input.steps, 0, new Set([id]));
  const rows: {
    id: string;
    scenarioId: string;
    parentId: string | null;
    stepType: string;
    refId: string | null;
    name: string;
    config: object;
    enabled: boolean;
    order: number;
  }[] = [];
  // 主键服务端生成：前端 uid 只是树键（作全局主键会与其它场景同名 uid 冲突 P2002，
  // 且历史数据已存在——全删重建天然换新 id，树形经 parentId=父新 id 重建）
  const walk = (nodes: ScenarioStepNode[], parentId: string | null) => {
    nodes.forEach((n, i) => {
      const stepId = crypto.randomUUID();
      rows.push({
        id: stepId,
        scenarioId: id,
        parentId,
        stepType: n.stepType,
        refId: (n.config as { refId?: string }).refId ?? null,
        name: n.name,
        config: n.config as object,
        enabled: n.enabled,
        order: i,
      });
      walk(n.children, stepId);
    });
  };
  walk(input.steps, null);
  await prisma.$transaction(async (tx) => {
    await tx.scenarioStep.deleteMany({ where: { scenarioId: id } });
    if (rows.length > 0) await tx.scenarioStep.createMany({ data: rows });
    await tx.scenario.update({ where: { id }, data: { version: s.version + 1 } });
  });
  await appendChangeLog(id, "update", { steps: `${rows.length} 步` }, userId);
  return { id, version: s.version + 1, stepCount: rows.length };
}

/** 场景引用循环检测：ref_scenario 目标链回到自身 → 40476。 */
async function assertNoCircularRef(
  projectId: string,
  selfId: string,
  steps: ScenarioStepNode[],
  depth: number,
  seen: Set<string>,
) {
  if (depth > 5) throw new DomainError(ErrCode.SCENARIO_CIRCULAR_REF, "场景引用链深度超限（≤5）");
  for (const n of steps) {
    if (n.stepType === "ref_scenario") {
      const refId = (n.config as { refId?: string }).refId;
      if (!refId) continue;
      if (refId === selfId || seen.has(refId))
        throw new DomainError(ErrCode.SCENARIO_CIRCULAR_REF, "场景引用形成循环");
      const target = await prisma.scenario.findFirst({
        where: { id: refId, projectId },
        select: { steps: { select: { id: true, stepType: true, config: true } } },
      });
      if (!target) throw new DomainError(ErrCode.SCENARIO_NOT_FOUND, `被引用场景 ${refId} 不存在`);
      const childSteps = target.steps
        .filter((st) => st.stepType === "ref_scenario")
        .map((st) => ({
          uid: st.id,
          stepType: "ref_scenario" as const,
          name: "",
          enabled: true,
          config: (st.config as Record<string, unknown>) ?? {},
          children: [],
        }));
      const nextSeen = new Set(seen);
      nextSeen.add(refId);
      await assertNoCircularRef(projectId, selfId, childSteps, depth + 1, nextSeen);
    }
    await assertNoCircularRef(projectId, selfId, n.children, depth, seen);
  }
}

export async function deleteScenario(projectId: string, userId: string, id: string) {
  const s = await getScenario(projectId, id);
  await prisma.scenario.update({ where: { id }, data: { deletedAt: new Date() } });
  await appendChangeLog(id, "delete", { name: s.name }, userId);
  return { id };
}

export async function restoreScenario(projectId: string, userId: string, id: string) {
  const s = await getScenario(projectId, id, true);
  if (!s.deletedAt) throw new DomainError(ErrCode.SCENARIO_NOT_FOUND, "场景未在回收站中");
  await prisma.scenario.update({ where: { id }, data: { deletedAt: null } });
  await appendChangeLog(id, "restore", { name: s.name }, userId);
  return { id };
}

export async function purgeScenario(projectId: string, id: string) {
  await getScenario(projectId, id, true);
  await prisma.$transaction(async (tx) => {
    await tx.scenarioStep.deleteMany({ where: { scenarioId: id } });
    await tx.scenario.delete({ where: { id } });
  });
  return { id };
}

export async function copyScenario(projectId: string, userId: string, id: string) {
  const s = await getScenario(projectId, id);
  const steps = await prisma.scenarioStep.findMany({ where: { scenarioId: id } });
  const num = await nextNum(prisma, "scenarios", projectId);
  const created = await prisma.scenario.create({
    data: {
      projectId,
      moduleId: s.moduleId,
      num,
      name: `${s.name}-copy`,
      level: s.level,
      status: s.status,
      tags: (s.tags ?? []) as never,
      config: (s.config ?? {}) as never,
      createdBy: userId,
    },
  });
  // 步骤树复制（新 id 映射）
  const idMap = new Map<string, string>();
  for (const st of steps) idMap.set(st.id, crypto.randomUUID());
  await prisma.scenarioStep.createMany({
    data: steps.map((st) => ({
      id: idMap.get(st.id)!,
      scenarioId: created.id,
      parentId: st.parentId ? idMap.get(st.parentId)! : null,
      stepType: st.stepType,
      refId: st.refId,
      name: st.name,
      config: (st.config ?? {}) as never,
      enabled: st.enabled,
      order: st.order,
    })),
  });
  await appendChangeLog(created.id, "create", { name: created.name, copyOf: id }, userId);
  return { id: created.id, num };
}

export async function batchDelete(projectId: string, userId: string, input: BatchInput) {
  const r = await prisma.scenario.updateMany({
    where: { id: { in: input.ids }, projectId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  for (const id of input.ids) await appendChangeLog(id, "delete", { batch: true }, userId);
  return { count: r.count };
}

export async function batchMove(projectId: string, input: BatchInput) {
  if (!input.moduleId) throw new DomainError(ErrCode.VALIDATION_FAILED, "目标模块必填");
  const r = await prisma.scenario.updateMany({
    where: { id: { in: input.ids }, projectId, deletedAt: null },
    data: { moduleId: input.moduleId },
  });
  return { count: r.count };
}

export async function batchCopy(projectId: string, userId: string, input: BatchInput) {
  const results = [];
  for (const id of input.ids) results.push(await copyScenario(projectId, userId, id));
  return { count: results.length, list: results };
}

/** 执行历史（ExecItem refType=scenario 聚合，RPT-003/API-006 消费）。 */
export async function scenarioHistory(projectId: string, id: string) {
  await getScenario(projectId, id, true);
  const items = await prisma.execItem.findMany({
    where: { refType: "scenario", refId: id, task: { projectId } },
    orderBy: { finishedAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      result: true,
      startedAt: true,
      finishedAt: true,
      taskId: true,
      task: { select: { id: true, status: true, type: true, createdAt: true } },
    },
  });
  return items.map((it) => ({
    itemId: it.id,
    taskId: it.taskId,
    taskStatus: it.task.status,
    status: it.status,
    result: it.result,
    startedAt: it.startedAt?.toISOString() ?? null,
    finishedAt: it.finishedAt?.toISOString() ?? null,
  }));
}

/** 变更历史（ChangeLog 横切，API-002 同构）。 */
export async function scenarioChanges(projectId: string, id: string) {
  await getScenario(projectId, id, true);
  const logs = await prisma.changeLog.findMany({
    where: { entityType: "scenario", entityId: id },
    orderBy: { seq: "desc" },
    take: 50,
    select: {
      seq: true,
      action: true,
      diff: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  });
  return {
    items: logs.map((l) => ({
      seq: l.seq,
      action: l.action,
      diff: l.diff,
      user: l.user?.name ?? "",
      createdAt: l.createdAt.toISOString(),
    })),
  };
}
