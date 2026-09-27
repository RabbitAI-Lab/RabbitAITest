/**
 * DASH-001/DASH-002 工作台：聚合看板 + 我的待办/我关注的/我创建的。
 * 跨域读取经本文件聚合（各域数据源只经查询自身域表 + Follow 横切表，不反向依赖）。
 * S4 DASH-002：我关注的七维度筛选+项目维度；我创建的修正为创建人口径+接口域两维度；待办执行含接口域 refs。
 */
import { prisma } from "@rabbit/db";

export interface OverviewRange {
  from: Date;
  to: Date;
}

export function parseRange(range: string, fromStr?: string, toStr?: string): OverviewRange {
  const now = new Date();
  if (range === "3d") return { from: new Date(now.getTime() - 3 * 86400_000), to: now };
  if (range === "7d") return { from: new Date(now.getTime() - 7 * 86400_000), to: now };
  return {
    from: fromStr ? new Date(fromStr) : new Date(now.getTime() - 7 * 86400_000),
    to: toStr ? new Date(toStr) : now,
  };
}

export async function overview(projectId: string, orgId: string, range: OverviewRange) {
  const [caseTotal, caseNew, reviewPassRate, planProgress, bugPending, bugNew] = await Promise.all([
    prisma.functionalCase.count({ where: { projectId, deletedAt: null } }),
    prisma.functionalCase.count({
      where: { projectId, deletedAt: null, createdAt: { gte: range.from, lte: range.to } },
    }),
    reviewPassRateOf(projectId),
    planProgressTop(projectId, 3),
    (async () => {
      const { pendingCount } = await import("@/server/domains/bug/bug.service");
      return pendingCount(projectId, orgId);
    })(),
    prisma.bug.count({
      where: { projectId, deletedAt: null, createdAt: { gte: range.from, lte: range.to } },
    }),
  ]);
  return {
    caseCard: { total: caseTotal, newInRange: caseNew },
    reviewCard: reviewPassRate,
    planCard: { top: planProgress },
    bugCard: { pending: bugPending, newInRange: bugNew },
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
  };
}

/** 评审通过率 = 项目内未结束评审的加权（Σpass/Σ已评）。 */
async function reviewPassRateOf(projectId: string) {
  const reviews = await prisma.caseReview.findMany({
    where: { projectId, deletedAt: null },
    select: { status: true, cases: { select: { result: true } } },
  });
  let judged = 0;
  let pass = 0;
  for (const r of reviews) {
    for (const c of r.cases) {
      if (c.result && c.result !== "PENDING") {
        judged += 1;
        if (c.result === "PASS") pass += 1;
      }
    }
  }
  return {
    passRate: judged === 0 ? null : Math.round((pass / judged) * 100),
    underway: reviews.filter((r) => r.status === "UNDERWAY").length,
  };
}

async function planProgressTop(projectId: string, top: number) {
  const plans = await prisma.testPlan.findMany({
    where: { projectId, deletedAt: null, archivedAt: null, type: "PLAN" },
    select: { id: true, name: true, caseRefs: { select: { status: true } } },
  });
  return plans
    .map((p) => {
      const executed = p.caseRefs.filter((r) => r.status !== "NOT_RUN").length;
      const pass = p.caseRefs.filter((r) => r.status === "PASS").length;
      return {
        planId: p.id,
        name: p.name,
        progress: p.caseRefs.length === 0 ? 0 : Math.round((executed / p.caseRefs.length) * 100),
        passRate: p.caseRefs.length === 0 ? 0 : Math.round((pass / p.caseRefs.length) * 100),
      };
    })
    .sort((a, b) => b.progress - a.progress)
    .slice(0, top);
}

/** 我的待办：待我评审 / 我的计划执行（三类 refs，含接口域）/ 我的缺陷（处理人=我且非结束态）。 */
export async function todo(
  projectId: string,
  orgId: string,
  userId: string,
  kind: string,
  page: number,
  pageSize: number,
) {
  if (kind === "review") {
    const rows = await prisma.reviewCase.findMany({
      where: {
        result: "PENDING",
        review: {
          projectId,
          status: "UNDERWAY",
          deletedAt: null,
          reviewers: { array_contains: userId },
        },
      },
      include: { review: { select: { id: true, name: true, createdAt: true } } },
      orderBy: { id: "desc" },
    });
    const caseIds2 = rows.map((r) => r.caseId);
    const caseRows = caseIds2.length
      ? await prisma.functionalCase.findMany({
          where: { id: { in: caseIds2 }, deletedAt: null },
          select: { id: true, name: true },
        })
      : [];
    const caseNameMap = new Map(caseRows.map((c) => [c.id, c.name]));
    return pageOf(
      rows.map((r) => ({
        id: r.id,
        kind: "review" as const,
        title: caseNameMap.get(r.caseId) ?? "(已删除)",
        context: r.review.name,
        href: `/reviews/${r.review.id}`,
        createdAt: r.review.createdAt.toISOString(),
      })),
      page,
      pageSize,
    );
  }
  if (kind === "exec") {
    const rows = await prisma.planCaseRef.findMany({
      where: {
        execUserId: userId,
        status: "NOT_RUN",
        plan: { projectId, deletedAt: null, archivedAt: null },
      },
      include: { plan: { select: { id: true, name: true, createdAt: true } } },
      orderBy: { id: "desc" },
    });
    // S4：三类 refs 名称分流反查（功能直查本域；接口/场景经 Provider——dash 聚合文件允许，但保持口径统一走 Provider）
    const fnIds = rows.filter((r) => r.refType === "functional_case").map((r) => r.refId);
    const fnCases = fnIds.length
      ? await prisma.functionalCase.findMany({
          where: { id: { in: fnIds }, deletedAt: null },
          select: { id: true, name: true },
        })
      : [];
    const fnMap = new Map(fnCases.map((c) => [c.id, c.name]));
    const apiIds = rows.filter((r) => r.refType === "api_case").map((r) => r.refId);
    const scIds = rows.filter((r) => r.refType === "scenario").map((r) => r.refId);
    let apiMap = new Map<string, string>();
    let scMap = new Map<string, string>();
    if (apiIds.length > 0 || scIds.length > 0) {
      const { listApiRefSummary, listScenarioRefSummary } = await import(
        "@/server/domains/api/api-ref.provider"
      );
      if (apiIds.length > 0) apiMap = new Map((await listApiRefSummary(projectId, apiIds)).map((s) => [s.refId, s.name]));
      if (scIds.length > 0) scMap = new Map((await listScenarioRefSummary(projectId, scIds)).map((s) => [s.refId, s.name]));
    }
    return pageOf(
      rows.map((r) => ({
        id: r.id,
        kind: "exec" as const,
        refType: r.refType,
        title:
          r.refType === "functional_case"
            ? (fnMap.get(r.refId) ?? "(已删除)")
            : r.refType === "api_case"
              ? (apiMap.get(r.refId) ?? "(已删除)")
              : (scMap.get(r.refId) ?? "(已删除)"),
        context: r.plan.name,
        href: `/plans/${r.plan.id}`,
        createdAt: r.plan.createdAt.toISOString(),
      })),
      page,
      pageSize,
    );
  }
  // bug：处理人=我且非结束态
  const { getWorkflow } = await import("@/server/domains/project/template.service");
  const wf = await getWorkflow(orgId, projectId);
  const endSerials = wf.states.filter((s) => s.isEnd).map((s) => s.serial);
  const rows = await prisma.bug.findMany({
    where: { projectId, deletedAt: null, handleUserId: userId, status: { notIn: endSerials } },
    orderBy: { updatedAt: "desc" },
  });
  return pageOf(
    rows.map((b) => ({
      id: b.id,
      kind: "bug" as const,
      title: b.title,
      context: `B-${String(b.num).padStart(4, "0")}`,
      href: `/bugs/${b.id}`,
      createdAt: b.updatedAt.toISOString(),
    })),
    page,
    pageSize,
  );
}

function pageOf<T>(items: T[], page: number, pageSize: number) {
  return { total: items.length, items: items.slice((page - 1) * pageSize, page * pageSize) };
}

const KIND_TO_ENTITY: Record<string, string> = {
  case: "functional_case",
  plan: "test_plan",
  review: "case_review",
  api_case: "api_case",
  scenario: "scenario",
  bug: "bug",
};

/** 我关注的（S4：kind 七维度筛选 + 项目维度过滤——api_case 经 ApiDefinition.projectId）。 */
export async function followed(
  userId: string,
  projectId: string | undefined,
  kind: string | undefined,
  page: number,
  pageSize: number,
) {
  const entityType = kind ? KIND_TO_ENTITY[kind] : undefined;
  const follows = await prisma.follow.findMany({
    where: { userId, ...(entityType ? { entityType } : {}) },
    orderBy: { createdAt: "desc" },
  });
  const items: { id: string; kind: string; title: string; href: string; updatedAt: string }[] = [];
  for (const f of follows) {
    if (f.entityType === "functional_case") {
      const c = await prisma.functionalCase.findFirst({
        where: { id: f.entityId, deletedAt: null, ...(projectId ? { projectId } : {}) },
        select: { id: true, name: true, updatedAt: true },
      });
      if (c)
        items.push({ id: c.id, kind: "case", title: c.name, href: `/cases/${c.id}`, updatedAt: c.updatedAt.toISOString() });
    } else if (f.entityType === "bug") {
      const b = await prisma.bug.findFirst({
        where: { id: f.entityId, deletedAt: null, ...(projectId ? { projectId } : {}) },
        select: { id: true, title: true, updatedAt: true },
      });
      if (b)
        items.push({ id: b.id, kind: "bug", title: b.title, href: `/bugs/${b.id}`, updatedAt: b.updatedAt.toISOString() });
    } else if (f.entityType === "test_plan") {
      const p = await prisma.testPlan.findFirst({
        where: { id: f.entityId, deletedAt: null, ...(projectId ? { projectId } : {}) },
        select: { id: true, name: true, updatedAt: true },
      });
      if (p)
        items.push({ id: p.id, kind: "plan", title: p.name, href: `/plans/${p.id}`, updatedAt: p.updatedAt.toISOString() });
    } else if (f.entityType === "case_review") {
      const r = await prisma.caseReview.findFirst({
        where: { id: f.entityId, deletedAt: null, ...(projectId ? { projectId } : {}) },
        select: { id: true, name: true, updatedAt: true },
      });
      if (r)
        items.push({ id: r.id, kind: "review", title: r.name, href: `/reviews/${r.id}`, updatedAt: r.updatedAt.toISOString() });
    }
  }
  // 接口域两维度经 Provider（dash 聚合唯一通道；projectId 过滤经 ApiCase→ApiDefinition join 在 Provider 内完成）
  const apiFollows = follows.filter((f) => f.entityType === "api_case");
  const scFollows = follows.filter((f) => f.entityType === "scenario");
  if (apiFollows.length > 0 || scFollows.length > 0) {
    const { listApiRefSummary, listScenarioRefSummary } = await import(
      "@/server/domains/api/api-ref.provider"
    );
    if (apiFollows.length > 0) {
      const summaries = await listApiRefSummary(projectId ?? "", apiFollows.map((f) => f.entityId));
      const nameMap = new Map(summaries.map((s) => [s.refId, s]));
      for (const f of apiFollows) {
        const s = nameMap.get(f.entityId);
        if (s && !s.deleted)
          items.push({ id: f.entityId, kind: "api_case", title: s.name, href: `/apis`, updatedAt: "" });
      }
    }
    if (scFollows.length > 0) {
      const summaries = await listScenarioRefSummary(projectId ?? "", scFollows.map((f) => f.entityId));
      for (const s of summaries) {
        items.push({ id: s.refId, kind: "scenario", title: s.name, href: `/scenarios`, updatedAt: s.updatedAt });
      }
    }
  }
  return pageOf(items, page, pageSize);
}

/** 我创建的（S4 修正：createdBy=me 口径 + api_case/scenario 维度）。 */
export async function created(
  projectId: string,
  userId: string,
  kind: string,
  page: number,
  pageSize: number,
) {
  if (kind === "review") {
    const rows = await prisma.caseReview.findMany({
      where: { projectId, deletedAt: null, createdBy: userId },
      orderBy: { createdAt: "desc" },
    });
    return pageOf(
      rows.map((r) => ({
        id: r.id,
        kind: "review",
        title: r.name,
        href: `/reviews/${r.id}`,
        createdAt: r.createdAt.toISOString(),
      })),
      page,
      pageSize,
    );
  }
  if (kind === "plan") {
    const rows = await prisma.testPlan.findMany({
      where: { projectId, deletedAt: null, createdBy: userId, type: "PLAN" },
      orderBy: { createdAt: "desc" },
    });
    return pageOf(
      rows.map((p) => ({
        id: p.id,
        kind: "plan",
        title: p.name,
        href: `/plans/${p.id}`,
        createdAt: p.createdAt.toISOString(),
      })),
      page,
      pageSize,
    );
  }
  if (kind === "bug") {
    const rows = await prisma.bug.findMany({
      where: { projectId, deletedAt: null, createdBy: userId },
      orderBy: { createdAt: "desc" },
    });
    return pageOf(
      rows.map((b) => ({
        id: b.id,
        kind: "bug",
        title: b.title,
        href: `/bugs/${b.id}`,
        createdAt: b.createdAt.toISOString(),
      })),
      page,
      pageSize,
    );
  }
  if (kind === "api_case" || kind === "scenario") {
    const { listCreatedApiCases, listCreatedScenarios } = await import(
      "@/server/domains/api/api-ref.provider"
    );
    if (kind === "api_case") {
      const rows = await listCreatedApiCases(projectId, userId);
      return pageOf(
        rows.map((c) => ({
          id: c.id,
          kind: "api_case",
          title: c.name,
          href: `/apis/${c.apiId}?case=${c.id}`,
          createdAt: c.createdAt,
        })),
        page,
        pageSize,
      );
    }
    const rows = await listCreatedScenarios(projectId, userId);
    return pageOf(
      rows.map((s) => ({
        id: s.id,
        kind: "scenario",
        title: s.name,
        href: `/scenarios/${s.id}`,
        createdAt: s.createdAt,
      })),
      page,
      pageSize,
    );
  }
  const rows = await prisma.functionalCase.findMany({
    where: { projectId, deletedAt: null, createdBy: userId },
    orderBy: { createdAt: "desc" },
  });
  return pageOf(
    rows.map((c) => ({
      id: c.id,
      kind: "case",
      title: c.name,
      href: `/cases/${c.id}`,
      createdAt: c.createdAt.toISOString(),
    })),
    page,
    pageSize,
  );
}
