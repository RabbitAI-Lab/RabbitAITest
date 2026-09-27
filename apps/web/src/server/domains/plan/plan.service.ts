/** PLAN-001：测试计划——CRUD、关联用例、列表模式执行（步骤级）、通过率、归档、报告。 */
import {
  DomainError,
  ErrCode,
  planPassRate,
  planUpsertSchema,
  planExecSchema,
} from "@rabbit/shared";
import type { z } from "zod";
import { prisma } from "@rabbit/db";

type PlanUpsert = z.infer<typeof planUpsertSchema>;
type PlanExec = z.infer<typeof planExecSchema>;

async function loadPlan(projectId: string, planId: string) {
  const p = await prisma.testPlan.findFirst({
    where: { id: planId, projectId, deletedAt: null },
    select: { id: true, name: true, archivedAt: true, settings: true },
  });
  if (!p) throw new DomainError(ErrCode.PLAN_NOT_FOUND, "计划不存在或已删除");
  return p;
}

function requireNotArchived(archivedAt: Date | null) {
  if (archivedAt) throw new DomainError(ErrCode.PLAN_ARCHIVED, "计划已归档，只读");
}

export async function listPlans(
  projectId: string,
  query: { keyword?: string; archived?: string; page?: number; pageSize?: number },
) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const where = {
    projectId,
    deletedAt: null,
    ...(query.archived === "only" ? { archivedAt: { not: null } } : { archivedAt: null }),
    ...(query.keyword ? { name: { contains: query.keyword, mode: "insensitive" as const } } : {}),
  };
  const [total, plans] = await Promise.all([
    prisma.testPlan.count({ where }),
    prisma.testPlan.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { caseRefs: { select: { status: true } } },
    }),
  ]);
  return {
    total,
    items: plans.map((p) => {
      const stats = planPassRate(p.caseRefs);
      const settings = (p.settings ?? {}) as { threshold?: number };
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        moduleId: p.moduleId,
        startAt: p.startAt?.toISOString() ?? null,
        endAt: p.endAt?.toISOString() ?? null,
        tags: (p.tags ?? []) as string[],
        settings: (p.settings ?? {}) as Record<string, unknown>,
        status: p.status,
        archivedAt: p.archivedAt?.toISOString() ?? null,
        caseCount: p.caseRefs.length,
        executed: stats.executed,
        progress:
          p.caseRefs.length === 0 ? 0 : Math.round((stats.executed / p.caseRefs.length) * 100),
        passRate: stats.passRate,
        thresholdMet:
          stats.passRate === null ? null : stats.passRate >= (settings.threshold ?? 100),
        createdAt: p.createdAt.toISOString(),
      };
    }),
  };
}

export async function createPlan(projectId: string, userId: string, input: PlanUpsert) {
  return prisma.testPlan.create({
    data: {
      projectId,
      name: input.name,
      description: input.description,
      moduleId: input.moduleId ?? null,
      startAt: input.startAt ? new Date(input.startAt) : null,
      endAt: input.endAt ? new Date(input.endAt) : null,
      tags: input.tags,
      settings: input.settings ?? {
        allowDuplicate: false,
        autoUpdateStatus: false,
        threshold: 100,
      },
      createdBy: userId,
    },
    select: { id: true, name: true },
  });
}

export async function getPlan(projectId: string, planId: string) {
  const p = await prisma.testPlan.findFirst({
    where: { id: planId, projectId, deletedAt: null },
  });
  if (!p) throw new DomainError(ErrCode.PLAN_NOT_FOUND, "计划不存在或已删除");
  const allRefs = await prisma.planCaseRef.findMany({
    where: { planId },
    orderBy: { id: "asc" },
  });
  // CASE-006/S2：接口用例关联行（refType=api_case）一并透出（名称经 ApiRefProvider，执行随 S4）
  const fnRefs = allRefs.filter((r) => r.refType === "functional_case");
  const apiRefs = allRefs.filter((r) => r.refType === "api_case");
  const scenarioRefs = allRefs.filter((r) => r.refType === "scenario");
  const caseIds = fnRefs.map((r) => r.refId);
  const caseRows = caseIds.length
    ? await prisma.functionalCase.findMany({
        where: { id: { in: caseIds }, deletedAt: null },
        select: { id: true, num: true, name: true, level: true, steps: true, tags: true },
      })
    : [];
  const caseMap = new Map(caseRows.map((c) => [c.id, c]));
  const refs = fnRefs.filter((r) => caseMap.has(r.refId));
  let apiSummaries: {
    refId: string;
    name: string;
    apiName: string;
    method: string;
    path: string;
    level: string;
    status: string;
    deleted: boolean;
  }[] = [];
  if (apiRefs.length > 0) {
    // 接口域读只经 Provider 通道（禁止本文件直查 api 域模型——test-domain-model §3）
    const { listApiRefSummary } = await import("@/server/domains/api/api-ref.provider");
    apiSummaries = await listApiRefSummary(projectId, apiRefs.map((r) => r.refId));
  }
  const apiMap = new Map(apiSummaries.map((s) => [s.refId, s]));
  let scenarioSummaries: { refId: string; name: string; level: string; status: string; updatedAt: string }[] = [];
  if (scenarioRefs.length > 0) {
    const { listScenarioRefSummary } = await import("@/server/domains/api/api-ref.provider");
    scenarioSummaries = await listScenarioRefSummary(projectId, scenarioRefs.map((r) => r.refId));
  }
  const scenarioMap = new Map(scenarioSummaries.map((s) => [s.refId, s]));
  // S4 统计口径升级：三类 refs 统一参与（引擎执行回写 api_case/scenario 状态；功能用例人工/自动）
  const stats = planPassRate(allRefs.map((r) => ({ status: r.status })));
  const settings = (p.settings ?? {}) as {
    threshold?: number;
    allowDuplicate?: boolean;
    autoUpdateStatus?: boolean;
    execConfig?: Record<string, unknown>;
  };
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    moduleId: p.moduleId,
    startAt: p.startAt?.toISOString() ?? null,
    endAt: p.endAt?.toISOString() ?? null,
    tags: (p.tags ?? []) as string[],
    settings: { allowDuplicate: false, autoUpdateStatus: false, threshold: 100, ...settings },
    status: p.status,
    archivedAt: p.archivedAt?.toISOString() ?? null,
    stats,
    passRate: stats.passRate,
    thresholdMet: stats.passRate === null ? null : stats.passRate >= (settings.threshold ?? 100),
    caseCount: allRefs.length,
    cases: [
      ...refs.map((r) => {
        const c = caseMap.get(r.refId)!;
        return {
          refId: r.id,
          refType: "functional_case" as const,
          caseId: r.refId,
          pointId: r.pointId,
          num: c.num,
          name: c.name,
          level: c.level,
          tags: (c.tags ?? []) as string[],
          steps: (c.steps ?? []) as { desc: string; expect: string }[],
          execUserId: r.execUserId,
          status: r.status,
          result: (r.result ?? {}) as {
            actualResult?: string;
            steps?: { status: string; result: string }[];
            comment?: string;
          },
          execHistory: (r.execHistory ?? []) as {
            ts: string;
            userId: string;
            from: string;
            to: string;
          }[],
        };
      }),
      ...apiRefs.flatMap((r) => {
        const s = apiMap.get(r.refId);
        return s
          ? [
              {
                refId: r.id,
                refType: "api_case" as const,
                caseId: r.refId,
                pointId: r.pointId,
                num: null,
                name: s.name,
                level: s.level,
                tags: [] as string[],
                steps: [] as { desc: string; expect: string }[],
                execUserId: r.execUserId,
                status: r.status,
                result: (r.result ?? {}) as Record<string, unknown>,
                execHistory: (r.execHistory ?? []) as {
                  ts: string;
                  userId: string;
                  from: string;
                  to: string;
                }[],
                apiName: s.apiName,
                method: s.method,
                path: s.path,
                deleted: s.deleted,
              },
            ]
          : [];
      }),
      ...scenarioRefs.flatMap((r) => {
        const s = scenarioMap.get(r.refId);
        return s
          ? [
              {
                refId: r.id,
                refType: "scenario" as const,
                caseId: r.refId,
                pointId: r.pointId,
                num: null,
                name: s.name,
                level: s.level,
                tags: [] as string[],
                steps: [] as { desc: string; expect: string }[],
                execUserId: r.execUserId,
                status: r.status,
                result: (r.result ?? {}) as Record<string, unknown>,
                execHistory: (r.execHistory ?? []) as {
                  ts: string;
                  userId: string;
                  from: string;
                  to: string;
                }[],
                scenarioStatus: s.status,
                deleted: false,
              },
            ]
          : [];
      }),
    ],
  };
}

export async function updatePlan(projectId: string, planId: string, input: Partial<PlanUpsert>) {
  const p = await loadPlan(projectId, planId);
  requireNotArchived(p.archivedAt);
  return prisma.testPlan.update({
    where: { id: planId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.moduleId !== undefined ? { moduleId: input.moduleId } : {}),
      ...(input.startAt !== undefined
        ? { startAt: input.startAt ? new Date(input.startAt) : null }
        : {}),
      ...(input.endAt !== undefined ? { endAt: input.endAt ? new Date(input.endAt) : null } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.settings !== undefined ? { settings: input.settings } : {}),
    },
    select: { id: true, name: true },
  });
}

export async function deletePlan(projectId: string, planId: string) {
  const p = await loadPlan(projectId, planId);
  requireNotArchived(p.archivedAt);
  await prisma.$transaction(async (tx) => {
    await tx.planCaseRef.deleteMany({ where: { planId } });
    await tx.testPlan.delete({ where: { id: planId } });
  });
  return { ok: true };
}

export async function archivePlan(projectId: string, planId: string, archived: boolean) {
  const p = await loadPlan(projectId, planId);
  if (archived === Boolean(p.archivedAt)) return { id: planId, archived };
  await prisma.testPlan.update({
    where: { id: planId },
    data: { archivedAt: archived ? new Date() : null, status: archived ? "ARCHIVED" : "UNDERWAY" },
  });
  return { id: planId, archived };
}

/** 批量关联用例：重复关联开关关闭时同用例二次关联 422（code 10009）。
 * S4 PLAN-002：+pointId 挂点、+scenarioIds（refType=scenario，经场景域校验）。 */
export async function addPlanCases(
  projectId: string,
  planId: string,
  caseIds: string[],
  execUserId?: string,
  /** CASE-006：接口用例关联（refType=api_case 经 ApiRefProvider 校验，执行随 S4 PLAN-003） */
  apiCaseIds: string[] = [],
  /** S4：场景关联（refType=scenario 经场景域存在性校验） */
  scenarioIds: string[] = [],
  /** S4：挂载测试点（null=未分组） */
  pointId: string | null = null,
) {
  const p = await loadPlan(projectId, planId);
  requireNotArchived(p.archivedAt);
  const beforeCount = await prisma.planCaseRef.count({ where: { planId } });
  const settings = (p.settings ?? {}) as { allowDuplicate?: boolean };
  if (pointId) {
    const point = await prisma.testPoint.findFirst({ where: { id: pointId, planId }, select: { id: true } });
    if (!point) throw new DomainError(ErrCode.POINT_NOT_FOUND, "测试点不存在");
  }
  const cases = await prisma.functionalCase.findMany({
    where: { id: { in: caseIds }, projectId, deletedAt: null },
    select: { id: true },
  });
  if (scenarioIds.length > 0) {
    // 场景域读经 api-ref.provider（禁止本文件直查 api 域模型——test-domain-model §3）
    const { batchValidateScenarioRefs, assertNoInvalidRef } = await import(
      "@/server/domains/api/api-ref.provider"
    );
    const { valid, invalid } = await batchValidateScenarioRefs(projectId, scenarioIds);
    assertNoInvalidRef(invalid);
    const existing = await prisma.planCaseRef.findMany({
      where: { planId, refType: "scenario", refId: { in: valid } },
      select: { refId: true },
    });
    const existingSet = new Set(existing.map((e) => e.refId));
    const dup = valid.filter((id) => existingSet.has(id));
    if (dup.length > 0 && !settings.allowDuplicate) {
      throw new DomainError(ErrCode.DUP_ASSOC, `重复关联 ${dup.length} 个场景（计划未开启「允许重复关联」）`);
    }
    for (const refId of valid) {
      if (existingSet.has(refId)) continue;
      await prisma.planCaseRef.create({
        data: { planId, refType: "scenario", refId, pointId, execUserId: execUserId ?? null, status: "NOT_RUN" },
      });
    }
  }
  if (apiCaseIds.length > 0) {
    // 接口用例走 Provider 通道（禁止本文件直查 api 域模型——test-domain-model §3）
    const { batchValidateApiRefs, assertNoInvalidRef } = await import(
      "@/server/domains/api/api-ref.provider"
    );
    const { valid, invalid } = await batchValidateApiRefs(projectId, apiCaseIds);
    assertNoInvalidRef(invalid);
    const apiExisting = await prisma.planCaseRef.findMany({
      where: { planId, refType: "api_case", refId: { in: valid } },
      select: { refId: true },
    });
    const apiExistingSet = new Set(apiExisting.map((e) => e.refId));
    const apiDup = valid.filter((id) => apiExistingSet.has(id));
    if (apiDup.length > 0 && !settings.allowDuplicate) {
      throw new DomainError(ErrCode.DUP_ASSOC, `重复关联 ${apiDup.length} 条接口用例（计划未开启「允许重复关联」）`);
    }
    for (const refId of valid) {
      if (apiExistingSet.has(refId)) continue;
      await prisma.planCaseRef.create({
        data: { planId, refType: "api_case", refId, pointId, execUserId: execUserId ?? null, status: "NOT_RUN" },
      });
    }
  }
  const existing = await prisma.planCaseRef.findMany({
    where: { planId, refType: "functional_case", refId: { in: caseIds } },
    select: { refId: true },
  });
  const existingSet = new Set(existing.map((e) => e.refId));
  const dup = cases.filter((c) => existingSet.has(c.id));
  if (dup.length > 0 && !settings.allowDuplicate) {
    throw new DomainError(
      ErrCode.DUP_ASSOC,
      `重复关联 ${dup.length} 条用例（计划未开启「允许重复关联」）`,
    );
  }
  for (const c of cases) {
    if (existingSet.has(c.id)) continue; // 开关开启时静默跳过
    await prisma.planCaseRef.create({
      data: {
        planId,
        refType: "functional_case",
        refId: c.id,
        pointId,
        execUserId: execUserId ?? null,
        status: "NOT_RUN",
      },
    });
  }
  await refreshPlanStatus(planId);
  // added=三类实际新建数（S4 口径：仅功能用例计数的老口径废弃）
  const after = await prisma.planCaseRef.count({ where: { planId } });
  return { added: after - beforeCount };
}

export async function removePlanCase(projectId: string, planId: string, refId: string) {
  const p = await loadPlan(projectId, planId);
  requireNotArchived(p.archivedAt);
  await prisma.planCaseRef.deleteMany({ where: { id: refId, planId } });
  await refreshPlanStatus(planId);
  return { ok: true };
}

/** 执行状态机：NOT_RUN → 终态可再执行（重置后标记）；步骤对位校验；写执行历史。 */
export async function execPlanCase(
  projectId: string,
  planId: string,
  refId: string,
  userId: string,
  input: PlanExec,
) {
  const p = await loadPlan(projectId, planId);
  requireNotArchived(p.archivedAt);
  const ref = await prisma.planCaseRef.findFirst({ where: { id: refId, planId } });
  if (!ref || ref.refType !== "functional_case")
    throw new DomainError(ErrCode.PLAN_NOT_FOUND, "关联记录不存在");
  const caseRow = await prisma.functionalCase.findFirst({
    where: { id: ref.refId, deletedAt: null },
    select: { steps: true },
  });
  const caseSteps = (caseRow?.steps ?? []) as { desc: string; expect: string }[];
  if (input.steps && input.steps.length !== caseSteps.length) {
    throw new DomainError(
      ErrCode.VALIDATION_FAILED,
      `步骤结果数量（${input.steps.length}）须与用例步骤数（${caseSteps.length}）一致`,
    );
  }
  const steps =
    input.steps ??
    caseSteps.map(() => ({
      status: input.status === "NOT_RUN" ? "NOT_RUN" : input.status,
      result: "",
    }));
  // S4 CASE-008 执行联动：前置用例在本计划内最近结果=FAIL → blockedBy 提示（软提示不硬阻断，默认建议 BLOCKED）
  const blockedBy = await findBlockingPredecessors(planId, ref.refId);
  const history = (ref.execHistory ?? []) as {
    ts: string;
    userId: string;
    from: string;
    to: string;
  }[];
  history.push({ ts: new Date().toISOString(), userId, from: ref.status, to: input.status });
  await prisma.planCaseRef.update({
    where: { id: refId },
    data: {
      status: input.status,
      result: JSON.parse(
        JSON.stringify({
          actualResult: input.actualResult,
          steps,
          comment: input.comment,
          ...(input.status === "BLOCKED" && blockedBy.length > 0 ? { blockedBy } : {}),
        }),
      ) as object,
      execHistory: JSON.parse(JSON.stringify(history)) as object[],
    },
  });
  await refreshPlanStatus(planId);
  return { refId, status: input.status, ...(blockedBy.length > 0 ? { blockedBy } : {}) };
}

/** 依赖联动（CASE-008 §2）：本用例前置 ∩ 本计划 refs 中最近结果=FAIL 的集合（提示层）。 */
async function findBlockingPredecessors(
  planId: string,
  caseId: string,
): Promise<{ caseId: string; name: string }[]> {
  const deps = await prisma.caseDependency.findMany({
    where: { postCaseId: caseId },
    select: { preCaseId: true },
  });
  if (deps.length === 0) return [];
  const preIds = deps.map((d) => d.preCaseId);
  const failedRefs = await prisma.planCaseRef.findMany({
    where: { planId, refType: "functional_case", refId: { in: preIds }, status: "FAIL" },
    select: { refId: true },
  });
  if (failedRefs.length === 0) return [];
  const failedCases = await prisma.functionalCase.findMany({
    where: { id: { in: failedRefs.map((r) => r.refId) }, deletedAt: null },
    select: { id: true, name: true },
  });
  return failedCases.map((c) => ({ caseId: c.id, name: c.name }));
}

export async function batchExecutor(
  projectId: string,
  planId: string,
  refIds: string[],
  execUserId: string,
) {
  const p = await loadPlan(projectId, planId);
  requireNotArchived(p.archivedAt);
  const r = await prisma.planCaseRef.updateMany({
    where: { id: { in: refIds }, planId },
    data: { execUserId },
  });
  return { affected: r.count };
}

/** 计划状态推进：有关联未执行→进行中；全部终态→已完成（无归档干扰）。（S4 导出：plan-exec 回调复用） */
export async function refreshPlanStatus(planId: string) {
  const refs = await prisma.planCaseRef.findMany({ where: { planId }, select: { status: true } });
  const plan = await prisma.testPlan.findFirst({
    where: { id: planId },
    select: { status: true, archivedAt: true },
  });
  if (!plan || plan.archivedAt) return;
  const allDone = refs.length > 0 && refs.every((r) => r.status !== "NOT_RUN");
  const anyExecuted = refs.some((r) => r.status !== "NOT_RUN");
  const next = allDone ? "COMPLETED" : anyExecuted ? "UNDERWAY" : "NOT_STARTED";
  if (next !== plan.status)
    await prisma.testPlan.update({ where: { id: planId }, data: { status: next } });
}

// ── 报告（最小报告：通过率卡 + 结果汇总 + 总结）──

export async function getPlanReport(projectId: string, planId: string) {
  const plan = await getPlan(projectId, planId);
  const report = await prisma.report.findFirst({
    where: { planId, reportType: "plan" },
    orderBy: { createdAt: "desc" },
    select: { id: true, summary: true, createdAt: true },
  });
  if (!report) {
    // 懒创建计划报告（reportType=plan）；taskId 外键→先建占位执行任务（S1 勘误：伪 id 违反 FK）
    const task = await prisma.execTask.findFirst({
      where: { type: "plan", refType: "plan", refId: planId },
      select: { id: true },
    });
    const taskId =
      task?.id ??
      (
        await prisma.execTask.create({
          data: {
            projectId,
            type: "plan",
            refType: "plan",
            refId: planId,
            status: "SUCCESS",
            payload: { placeholder: true },
            createdBy: "system",
          },
          select: { id: true },
        })
      ).id;
    const created = await prisma.report.create({
      data: {
        taskId,
        projectId,
        planId,
        reportType: "plan",
        name: `${plan.name}-报告`,
        createdBy: "system",
      },
      select: { id: true, summary: true, createdAt: true },
    });
    return { ...plan, reportId: created.id, summary: created.summary ?? "" };
  }
  return { ...plan, reportId: report.id, summary: report.summary ?? "" };
}

export async function updatePlanReportSummary(projectId: string, planId: string, summary: string) {
  const p = await loadPlan(projectId, planId);
  const existing = await prisma.report.findFirst({
    where: { planId, reportType: "plan" },
    select: { id: true },
  });
  if (existing) {
    await prisma.report.update({ where: { id: existing.id }, data: { summary } });
    return { reportId: existing.id };
  }
  const task = await prisma.execTask.findFirst({
    where: { type: "plan", refType: "plan", refId: planId },
    select: { id: true },
  });
  const taskId =
    task?.id ??
    (
      await prisma.execTask.create({
        data: {
          projectId,
          type: "plan",
          refType: "plan",
          refId: planId,
          status: "SUCCESS",
          payload: { placeholder: true },
          createdBy: "system",
        },
        select: { id: true },
      })
    ).id;
  const created = await prisma.report.create({
    data: {
      taskId,
      projectId,
      planId,
      reportType: "plan",
      name: `${p.name}-报告`,
      summary,
      createdBy: "system",
    },
    select: { id: true },
  });
  return { reportId: created.id };
}
