/** S4 PLAN-005 计划报告：完整视图（测试点维度明细）/ 一键总结草稿 / CSV 导出 / 分享（token 复用 ReportShare）。
 * 报告记录复用 Report（reportType=plan，PLAN-001 懒创建机制）；本文件只做视图构建与导出，不重复落 summary 之外的表。 */
import { randomBytes } from "node:crypto";
import {
  buildPlanReportCsv,
  buildPlanSummaryDraft,
  DomainError,
  ErrCode,
  planPassRate,
} from "@rabbit/shared";
import { prisma } from "@rabbit/db";

const REF_TYPE_LABEL: Record<string, string> = {
  functional_case: "功能",
  api_case: "接口",
  scenario: "场景",
};
const STATUS_LABEL: Record<string, string> = {
  NOT_RUN: "未执行",
  PASS: "通过",
  FAIL: "失败",
  BLOCKED: "阻塞",
  SKIPPED: "跳过",
};

export interface PlanReportView {
  reportId: string;
  planId: string;
  planName: string;
  threshold: number;
  overview: {
    total: number;
    executed: number;
    pass: number;
    fail: number;
    blocked: number;
    skipped: number;
    fakeError: number;
    passRate: number | null;
    thresholdMet: boolean | null;
  };
  points: {
    pointId: string | null;
    name: string;
    passRate: number | null;
    rows: PlanReportRow[];
  }[];
  summary: string;
  generatedAt: string;
}

export interface PlanReportRow {
  refId: string;
  refType: string;
  name: string;
  executor: string | null;
  status: string;
  actualResult: string;
  lastRunAt: string | null;
  reportTaskId: string | null;
}

/** 名称反查（跨域经 Provider——api_case/scenario 各自通道）。 */
async function resolveRefNames(
  projectId: string,
  refs: { refType: string; refId: string }[],
): Promise<Map<string, { name: string }>> {
  const map = new Map<string, { name: string }>();
  const fnIds = refs.filter((r) => r.refType === "functional_case").map((r) => r.refId);
  if (fnIds.length > 0) {
    const rows = await prisma.functionalCase.findMany({
      where: { id: { in: fnIds }, deletedAt: null },
      select: { id: true, name: true },
    });
    for (const r of rows) map.set(`functional_case:${r.id}`, { name: r.name });
  }
  const apiIds = refs.filter((r) => r.refType === "api_case").map((r) => r.refId);
  if (apiIds.length > 0) {
    const { listApiRefSummary } = await import("@/server/domains/api/api-ref.provider");
    for (const s of await listApiRefSummary(projectId, apiIds)) {
      if (!s.deleted) map.set(`api_case:${s.refId}`, { name: s.name });
    }
  }
  const scIds = refs.filter((r) => r.refType === "scenario").map((r) => r.refId);
  if (scIds.length > 0) {
    const { listScenarioRefSummary } = await import("@/server/domains/api/api-ref.provider");
    for (const s of await listScenarioRefSummary(projectId, scIds)) {
      map.set(`scenario:${s.refId}`, { name: s.name });
    }
  }
  return map;
}

/** 计划报告视图（点分组明细 + 概览 + 误报统计）。 */
export async function buildPlanReportView(projectId: string, planId: string): Promise<PlanReportView> {
  const plan = await prisma.testPlan.findFirst({
    where: { id: planId, projectId, deletedAt: null },
    select: { id: true, name: true, settings: true },
  });
  if (!plan) throw new DomainError(ErrCode.PLAN_NOT_FOUND, "计划不存在或已删除");
  const settings = (plan.settings ?? {}) as { threshold?: number };
  const threshold = settings.threshold ?? 100;

  const [refs, points, users] = await Promise.all([
    prisma.planCaseRef.findMany({ where: { planId }, orderBy: { id: "asc" } }),
    prisma.testPoint.findMany({ where: { planId }, orderBy: [{ order: "asc" }, { id: "asc" }] }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const nameMap = await resolveRefNames(projectId, refs);
  const userMap = new Map(users.map((u) => [u.id, u.name]));
  const pointName = new Map(points.map((p) => [p.id, p.name]));

  const stats = planPassRate(refs);
  // 误报数：最近一次 plan 任务的 FAKE_ERROR item 数
  const lastTask = await prisma.execTask.findFirst({
    where: { type: "plan", refType: "plan", refId: planId, status: { in: ["SUCCESS", "FAILED", "STOPPED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });
  let fakeError = 0;
  if (lastTask) {
    fakeError = await prisma.execItem.count({ where: { taskId: lastTask.id, status: "FAKE_ERROR" } });
  }

  const toRow = (r: (typeof refs)[number]): PlanReportRow => {
    const result = (r.result ?? {}) as { actualResult?: string; reportTaskId?: string; lastRunAt?: string };
    return {
      refId: r.id,
      refType: r.refType,
      name: nameMap.get(`${r.refType}:${r.refId}`)?.name ?? "(已删除)",
      executor: r.execUserId ? (userMap.get(r.execUserId) ?? null) : null,
      status: STATUS_LABEL[r.status] ?? r.status,
      actualResult: (result.actualResult ?? "").slice(0, 200),
      lastRunAt: result.lastRunAt ?? null,
      reportTaskId: result.reportTaskId ?? null,
    };
  };

  const pointGroups: PlanReportView["points"] = points.map((p) => {
    const own = refs.filter((r) => r.pointId === p.id);
    const ps = planPassRate(own);
    return {
      pointId: p.id,
      name: p.name,
      passRate: ps.passRate,
      rows: own.map(toRow),
    };
  });
  const ungrouped = refs.filter((r) => !r.pointId || !pointName.has(r.pointId));
  if (ungrouped.length > 0 || refs.length === 0) {
    const ps = planPassRate(ungrouped);
    pointGroups.push({ pointId: null, name: "未分组", passRate: ps.passRate, rows: ungrouped.map(toRow) });
  }

  // 报告记录（懒创建口径同 PLAN-001 getPlanReport；这里读现有或返回虚拟 id 由调用方落库）
  const report = await prisma.report.findFirst({
    where: { planId, reportType: "plan" },
    orderBy: { createdAt: "desc" },
    select: { id: true, summary: true, createdAt: true },
  });

  return {
    reportId: report?.id ?? "",
    planId: plan.id,
    planName: plan.name,
    threshold,
    overview: {
      total: refs.length,
      executed: stats.executed,
      pass: stats.pass,
      fail: stats.fail,
      blocked: stats.blocked,
      skipped: stats.skipped,
      fakeError,
      passRate: stats.passRate,
      thresholdMet: stats.passRate === null ? null : stats.passRate >= threshold,
    },
    points: pointGroups,
    summary: report?.summary ?? "",
    generatedAt: (report?.createdAt ?? new Date()).toISOString(),
  };
}

/** 一键总结草稿（纯统计模板；不落库——保存走既有 summary 端点，前端二次确认后才覆盖）。 */
export async function buildSummaryDraft(projectId: string, planId: string) {
  const view = await buildPlanReportView(projectId, planId);
  const weakest = view.points
    .filter((p) => p.rows.length > 0 && p.passRate !== null)
    .sort((a, b) => (a.passRate ?? 100) - (b.passRate ?? 100))[0];
  const lastRunAt = view.points
    .flatMap((p) => p.rows.map((r) => r.lastRunAt))
    .filter((t): t is string => Boolean(t))
    .sort()
    .at(-1) ?? null;
  return {
    draft: buildPlanSummaryDraft({
      planName: view.planName,
      total: view.overview.total,
      executed: view.overview.executed,
      passRate: view.overview.passRate,
      threshold: view.threshold,
      fail: view.overview.fail,
      blocked: view.overview.blocked,
      fakeError: view.overview.fakeError,
      weakestPoint: weakest && (weakest.passRate ?? 100) < 100 ? weakest.name : null,
      lastRunAt,
    }),
  };
}

/** CSV 明细导出（UTF-8 BOM 由路由层附加；attachment 下载语义）。 */
export async function exportPlanReportCsv(projectId: string, planId: string): Promise<{ filename: string; csv: string }> {
  const view = await buildPlanReportView(projectId, planId);
  const rows = view.points.flatMap((p) =>
    p.rows.map((r) => ({
      point: p.name,
      refType: REF_TYPE_LABEL[r.refType] ?? r.refType,
      name: r.name,
      executor: r.executor ?? "",
      status: r.status,
      actualResult: r.actualResult,
      lastRunAt: r.lastRunAt ?? "",
      reportUrl: r.reportTaskId ? `/reports/${r.reportTaskId}` : "",
    })),
  );
  return {
    filename: `${view.planName}-计划报告明细.csv`,
    csv: "\uFEFF" + buildPlanReportCsv(rows),
  };
}

/** 计划报告分享（token 复用 ReportShare；挂在 plan 报告记录上）。 */
export async function createPlanShare(projectId: string, planId: string, expireHours: number) {
  const { reportId } = await ensurePlanReport(projectId, planId);
  const token = randomBytes(24).toString("base64url");
  const share = await prisma.reportShare.create({
    data: { reportId, token, expireAt: new Date(Date.now() + expireHours * 3600 * 1000) },
  });
  return { token: share.token, expireAt: share.expireAt.toISOString() };
}

export async function listPlanShares(projectId: string, planId: string) {
  const { reportId } = await ensurePlanReport(projectId, planId);
  const shares = await prisma.reportShare.findMany({
    where: { reportId },
    orderBy: { createdAt: "desc" },
  });
  return {
    total: shares.length,
    items: shares.map((s) => ({
      token: s.token,
      expireAt: s.expireAt.toISOString(),
      expired: s.expireAt.getTime() < Date.now(),
      createdAt: s.createdAt.toISOString(),
    })),
  };
}

export async function revokePlanShare(projectId: string, planId: string, token: string) {
  const { reportId } = await ensurePlanReport(projectId, planId);
  await prisma.reportShare.deleteMany({ where: { reportId, token } });
  return { ok: true };
}

/** 免登录分享读：token → 计划报告视图（过期统一 SHARE_NOT_FOUND）。 */
export async function planShareDetail(token: string): Promise<PlanReportView & { planName: string }> {
  const share = await prisma.reportShare.findUnique({
    where: { token },
    include: { report: { select: { planId: true, projectId: true } } },
  });
  if (!share || !share.report.planId || share.expireAt.getTime() < Date.now())
    throw new DomainError(ErrCode.SHARE_NOT_FOUND, "分享链接不存在或已过期");
  return buildPlanReportView(share.report.projectId, share.report.planId);
}

/** 懒创建计划报告记录（PLAN-001 机制抽出复用；返回 reportId）。 */
async function ensurePlanReport(projectId: string, planId: string): Promise<{ reportId: string }> {
  const existing = await prisma.report.findFirst({
    where: { planId, reportType: "plan" },
    select: { id: true },
  });
  if (existing) return { reportId: existing.id };
  const plan = await prisma.testPlan.findFirst({
    where: { id: planId, projectId, deletedAt: null },
    select: { name: true },
  });
  if (!plan) throw new DomainError(ErrCode.PLAN_NOT_FOUND, "计划不存在或已删除");
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
    select: { id: true },
  });
  return { reportId: created.id };
}
