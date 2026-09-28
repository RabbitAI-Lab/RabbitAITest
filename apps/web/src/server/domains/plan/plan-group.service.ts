/** S4 PLAN-004 计划分组：组 CRUD/成员移动/组视图聚合/级联归档/组报告（TestPlan.type=GROUP 预建列，零迁移）。 */
import { DomainError, ErrCode, planGroupAggregate, planPassRate } from "@rabbit/shared";
import { prisma } from "@rabbit/db";

async function loadGroup(projectId: string, groupId: string) {
  const g = await prisma.testPlan.findFirst({
    where: { id: groupId, projectId, deletedAt: null, type: "GROUP" },
    select: { id: true, name: true, description: true, archivedAt: true },
  });
  if (!g) throw new DomainError(ErrCode.PLAN_GROUP_NOT_FOUND, "计划组不存在或已删除");
  return g;
}

/** 组视图：组行（聚合）+ 成员嵌套 + 未分组平铺。 */
export async function listPlanGroups(projectId: string, archived: boolean) {
  const groups = await prisma.testPlan.findMany({
    where: {
      projectId,
      deletedAt: null,
      type: "GROUP",
      archivedAt: archived ? { not: null } : null,
    },
    orderBy: { createdAt: "desc" },
    include: {
      caseRefs: false,
    },
  });
  const groupIds = groups.map((g) => g.id);
  // 全量成员（含未分组——groupId null；组视图在内存分组，ungrouped 单列）
  const members = await prisma.testPlan.findMany({
    where: {
      projectId,
      deletedAt: null,
      type: "PLAN",
      archivedAt: archived ? { not: null } : null,
    },
    include: { caseRefs: { select: { status: true } } },
    orderBy: { createdAt: "desc" },
  });
  const memberRows = members.map((m) => {
    const stats = planPassRate(m.caseRefs);
    const settings = (m.settings ?? {}) as { threshold?: number };
    return {
      id: m.id,
      name: m.name,
      groupId: m.groupId,
      caseCount: m.caseRefs.length,
      executed: stats.executed,
      progress:
        m.caseRefs.length === 0 ? 0 : Math.round((stats.executed / m.caseRefs.length) * 100),
      passRate: stats.passRate,
      thresholdMet: stats.passRate === null ? null : stats.passRate >= (settings.threshold ?? 100),
      status: m.status,
      archivedAt: m.archivedAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
    };
  });
  return {
    groups: groups.map((g) => {
      const own = memberRows.filter((m) => m.groupId === g.id);
      const agg = planGroupAggregate(
        own.map((m) => ({
          id: m.id,
          name: m.name,
          refs: members.find((x) => x.id === m.id)!.caseRefs,
          threshold:
            ((members.find((x) => x.id === m.id)!.settings ?? {}) as { threshold?: number })
              .threshold ?? 100,
        })),
      );
      return {
        id: g.id,
        name: g.name,
        description: g.description,
        archivedAt: g.archivedAt?.toISOString() ?? null,
        aggregate: agg,
        members: own,
      };
    }),
    ungrouped: memberRows.filter((m) => !m.groupId),
  };
}

export async function createPlanGroup(
  projectId: string,
  userId: string,
  input: { name: string; description?: string },
) {
  return prisma.testPlan.create({
    data: {
      projectId,
      type: "GROUP",
      name: input.name,
      description: input.description,
      status: "NOT_STARTED",
      createdBy: userId,
    },
    select: { id: true, name: true },
  });
}

export async function updatePlanGroup(
  projectId: string,
  groupId: string,
  input: { name?: string; description?: string },
) {
  const g = await loadGroup(projectId, groupId);
  if (g.archivedAt) throw new DomainError(ErrCode.PLAN_ARCHIVED, "计划组已归档，只读");
  await prisma.testPlan.update({
    where: { id: groupId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  });
  return { id: groupId };
}

export async function deletePlanGroup(projectId: string, groupId: string) {
  const g = await loadGroup(projectId, groupId);
  if (g.archivedAt) throw new DomainError(ErrCode.PLAN_ARCHIVED, "计划组已归档，只读");
  const memberCount = await prisma.testPlan.count({ where: { groupId, deletedAt: null } });
  if (memberCount > 0)
    throw new DomainError(
      ErrCode.PLAN_GROUP_NOT_EMPTY,
      `计划组内还有 ${memberCount} 个成员计划，请先移出`,
    );
  await prisma.testPlan.delete({ where: { id: groupId } });
  return { ok: true };
}

/** 计划移入/移出分组（单计划至多一组）。 */
export async function movePlanGroup(projectId: string, planId: string, groupId: string | null) {
  const plan = await prisma.testPlan.findFirst({
    where: { id: planId, projectId, deletedAt: null },
    select: { id: true, type: true },
  });
  if (!plan) throw new DomainError(ErrCode.PLAN_NOT_FOUND, "计划不存在或已删除");
  if (plan.type === "GROUP") throw new DomainError(ErrCode.GROUP_NESTED, "计划组不可嵌套入组");
  if (groupId) await loadGroup(projectId, groupId);
  await prisma.testPlan.update({ where: { id: planId }, data: { groupId } });
  return { planId, groupId };
}

/** 组归档级联（成员批量同置；恢复同理）。 */
export async function archivePlanGroup(projectId: string, groupId: string, archived: boolean) {
  const g = await loadGroup(projectId, groupId);
  if (archived === Boolean(g.archivedAt)) return { id: groupId, archived };
  const stamp = archived ? new Date() : null;
  await prisma.$transaction([
    prisma.testPlan.update({
      where: { id: groupId },
      data: { archivedAt: stamp, status: archived ? "ARCHIVED" : "NOT_STARTED" },
    }),
    prisma.testPlan.updateMany({
      where: { groupId, deletedAt: null, type: "PLAN" },
      data: { archivedAt: stamp, status: archived ? "ARCHIVED" : "UNDERWAY" },
    }),
  ]);
  return { id: groupId, archived };
}

/** 批量归档/恢复（计划与组混选；组级联成员）。 */
export async function batchArchivePlans(projectId: string, ids: string[], archived: boolean) {
  const stamp = archived ? new Date() : null;
  const groups = await prisma.testPlan.findMany({
    where: { id: { in: ids }, projectId, deletedAt: null, type: "GROUP" },
    select: { id: true },
  });
  const groupIds = groups.map((g) => g.id);
  await prisma.$transaction([
    prisma.testPlan.updateMany({
      where: { id: { in: ids }, projectId, deletedAt: null },
      data: { archivedAt: stamp, status: archived ? "ARCHIVED" : "UNDERWAY" },
    }),
    ...(groupIds.length > 0
      ? [
          prisma.testPlan.updateMany({
            where: { groupId: { in: groupIds }, deletedAt: null, type: "PLAN" },
            data: { archivedAt: stamp, status: archived ? "ARCHIVED" : "UNDERWAY" },
          }),
        ]
      : []),
  ]);
  return { affected: ids.length, cascadedGroups: groupIds.length };
}

/** 组聚合报告（懒创建 reportType=plan_group；成员统计+阈值判定+组总结）。 */
export async function getPlanGroupReport(projectId: string, groupId: string) {
  const g = await loadGroup(projectId, groupId);
  const members = await prisma.testPlan.findMany({
    where: { groupId, deletedAt: null, type: "PLAN" },
    include: { caseRefs: { select: { status: true } } },
    orderBy: { createdAt: "asc" },
  });
  const memberRows = members.map((m) => {
    const stats = planPassRate(m.caseRefs);
    const settings = (m.settings ?? {}) as { threshold?: number };
    const threshold = settings.threshold ?? 100;
    return {
      id: m.id,
      name: m.name,
      caseCount: m.caseRefs.length,
      executed: stats.executed,
      progress:
        m.caseRefs.length === 0 ? 0 : Math.round((stats.executed / m.caseRefs.length) * 100),
      passRate: stats.passRate,
      thresholdMet: stats.passRate === null ? null : stats.passRate >= threshold,
      status: m.status,
      archivedAt: m.archivedAt?.toISOString() ?? null,
      refs: m.caseRefs,
      threshold,
    };
  });
  const aggregate = planGroupAggregate(
    memberRows.map((m) => ({ id: m.id, name: m.name, refs: m.refs, threshold: m.threshold })),
  );
  // 懒创建组报告（占位任务同 plan 报告先例：伪 taskId 违反 FK → 先建占位任务）
  let report = await prisma.report.findFirst({
    where: { reportType: "plan_group", name: { startsWith: `组报告:${groupId}:` } },
    orderBy: { createdAt: "desc" },
    select: { id: true, summary: true, createdAt: true },
  });
  if (!report) {
    const task = await prisma.execTask.create({
      data: {
        projectId,
        type: "plan",
        refType: "plan_group",
        refId: groupId,
        status: "SUCCESS",
        payload: { placeholder: true },
        createdBy: "system",
      },
      select: { id: true },
    });
    report = await prisma.report.create({
      data: {
        taskId: task.id,
        projectId,
        reportType: "plan_group",
        name: `组报告:${groupId}:${g.name}`,
        createdBy: "system",
      },
      select: { id: true, summary: true, createdAt: true },
    });
  }
  return {
    groupId: g.id,
    name: g.name,
    description: g.description,
    archivedAt: g.archivedAt?.toISOString() ?? null,
    aggregate,
    members: memberRows.map(({ refs, threshold, ...rest }) => rest),
    reportId: report.id,
    summary: report.summary ?? "",
    generatedAt: report.createdAt.toISOString(),
  };
}

export async function updatePlanGroupReportSummary(
  projectId: string,
  groupId: string,
  summary: string,
) {
  await loadGroup(projectId, groupId);
  const existing = await prisma.report.findFirst({
    where: { reportType: "plan_group", name: { startsWith: `组报告:${groupId}:` } },
    select: { id: true },
  });
  if (existing) {
    await prisma.report.update({ where: { id: existing.id }, data: { summary } });
    return { reportId: existing.id };
  }
  // 不存在则经 getPlanGroupReport 懒创建后再写
  const created = await getPlanGroupReport(projectId, groupId);
  await prisma.report.update({ where: { id: created.reportId }, data: { summary } });
  return { reportId: created.reportId };
}
