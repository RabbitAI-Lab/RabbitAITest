/** CASE-005：用例评审——CRUD、关联、逐条/批量标记、多人聚合、重新提审、复制、结束。 */
import { DomainError, ErrCode, aggregateReviewResult, reviewUpsertSchema } from '@rabbit/shared';
import type { z } from 'zod';
import { prisma } from '@rabbit/db';
import type { Prisma } from '@rabbit/db';

const toJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v ?? {})) as Prisma.InputJsonValue;

type ReviewUpsert = z.infer<typeof reviewUpsertSchema>;

async function loadReview(projectId: string, reviewId: string) {
  const r = await prisma.caseReview.findFirst({
    where: { id: reviewId, projectId, deletedAt: null },
    select: { id: true, name: true, reviewMode: true, status: true, reviewers: true, startAt: true, endAt: true },
  });
  if (!r) throw new DomainError(ErrCode.REVIEW_NOT_FOUND, '评审不存在或已删除');
  return r;
}

function requireNotEnded(status: string) {
  if (status === 'ENDED') throw new DomainError(ErrCode.REVIEW_ENDED, '评审已结束，禁止操作');
}

export async function listReviews(projectId: string, viewerId: string, query: { view?: string; keyword?: string; page?: number; pageSize?: number }) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const where = {
    projectId,
    deletedAt: null,
    ...(query.view === 'mine' ? { reviewers: { array_contains: viewerId } } : {}),
    ...(query.view === 'created' ? { createdBy: viewerId } : {}),
    ...(query.keyword ? { name: { contains: query.keyword, mode: 'insensitive' as const } } : {}),
  };
  const [total, reviews] = await Promise.all([
    prisma.caseReview.count({ where }),
    prisma.caseReview.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { cases: { select: { result: true } } },
    }),
  ]);
  const items = reviews.map((r) => {
    const total2 = r.cases.length;
    const pass = r.cases.filter((c) => c.result === 'PASS').length;
    const fail = r.cases.filter((c) => c.result === 'FAIL').length;
    const suggest = r.cases.filter((c) => c.result === 'SUGGEST').length;
    const judged = r.cases.filter((c) => c.result && c.result !== 'PENDING').length;
    return {
      id: r.id, name: r.name, reviewMode: r.reviewMode,
      reviewers: (r.reviewers ?? []) as string[],
      status: r.status,
      startAt: r.startAt?.toISOString() ?? null,
      endAt: r.endAt?.toISOString() ?? null,
      caseCount: total2,
      stats: { pass, fail, suggest, pending: total2 - judged, judged },
      passRate: total2 === 0 ? 0 : Math.round((pass / total2) * 100),
      overdue: r.status === 'UNDERWAY' && r.endAt ? r.endAt.getTime() < Date.now() : false,
      createdAt: r.createdAt.toISOString(),
    };
  });
  return { total, items };
}

export async function getReview(projectId: string, reviewId: string, viewerId: string) {
  const r = await loadReview(projectId, reviewId);
  const cases = await prisma.reviewCase.findMany({
    where: { reviewId },
    orderBy: { id: 'asc' },
    include: {
      case: { select: { id: true, num: true, name: true, level: true, precondition: true, steps: true } },
    },
  });
  return {
    id: r.id, name: r.name, reviewMode: r.reviewMode as 'SINGLE' | 'MULTI', status: r.status,
    reviewers: (r.reviewers ?? []) as string[],
    startAt: r.startAt?.toISOString() ?? null, endAt: r.endAt?.toISOString() ?? null,
    isReviewer: ((r.reviewers ?? []) as string[]).includes(viewerId),
    cases: cases.map((rc) => ({
      refId: rc.id, caseId: rc.caseId, num: rc.case.num, name: rc.case.name, level: rc.case.level,
      precondition: rc.case.precondition,
      steps: (rc.case.steps ?? []) as { desc: string; expect: string }[],
      result: rc.result, reSubmit: rc.reSubmit,
      results: (rc.results ?? []) as { userId: string; result: string; comment: string; ts: string }[],
    })),
  };
}

export async function createReview(projectId: string, userId: string, input: ReviewUpsert) {
  const r = await prisma.caseReview.create({
    data: {
      projectId, name: input.name, description: input.description,
      reviewMode: input.reviewMode, reviewers: toJson(input.reviewers),
      startAt: input.startAt ? new Date(input.startAt) : null,
      endAt: input.endAt ? new Date(input.endAt) : null,
      createdBy: userId,
    },
    select: { id: true },
  });
  if (input.caseIds.length) await addReviewCases(projectId, r.id, input.caseIds);
  return r;
}

export async function updateReview(projectId: string, reviewId: string, input: Partial<ReviewUpsert>) {
  const r = await loadReview(projectId, reviewId);
  requireNotEnded(r.status);
  return prisma.caseReview.update({
    where: { id: reviewId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.reviewMode !== undefined ? { reviewMode: input.reviewMode } : {}),
      ...(input.reviewers !== undefined ? { reviewers: input.reviewers } : {}),
      ...(input.startAt !== undefined ? { startAt: input.startAt ? new Date(input.startAt) : null } : {}),
      ...(input.endAt !== undefined ? { endAt: input.endAt ? new Date(input.endAt) : null } : {}),
    },
    select: { id: true, name: true },
  });
}

export async function deleteReview(projectId: string, reviewId: string) {
  const r = await loadReview(projectId, reviewId);
  requireNotEnded(r.status);
  await prisma.$transaction(async (tx) => {
    await tx.reviewCase.deleteMany({ where: { reviewId } });
    await tx.caseReview.delete({ where: { id: reviewId } });
  });
}

/** 批量关联用例（去重：已在评审中的跳过）。 */
export async function addReviewCases(projectId: string, reviewId: string, caseIds: string[]) {
  const r = await loadReview(projectId, reviewId);
  requireNotEnded(r.status);
  const cases = await prisma.functionalCase.findMany({
    where: { id: { in: caseIds }, projectId, deletedAt: null },
    select: { id: true },
  });
  const existing = await prisma.reviewCase.findMany({ where: { reviewId, caseId: { in: caseIds } }, select: { caseId: true } });
  const existingSet = new Set(existing.map((e) => e.caseId));
  const toAdd = cases.filter((c) => !existingSet.has(c.id));
  for (const c of toAdd) {
    await prisma.reviewCase.create({
      data: { reviewId, caseId: c.id, reviewers: r.reviewers as string[], result: 'PENDING', results: [] },
    });
  }
  return { added: toAdd.length, skipped: caseIds.length - toAdd.length };
}

export async function removeReviewCase(projectId: string, reviewId: string, caseId: string) {
  const r = await loadReview(projectId, reviewId);
  requireNotEnded(r.status);
  await prisma.reviewCase.deleteMany({ where: { reviewId, caseId } });
  return { ok: true };
}

/** 逐条标记：仅评审人可标记（403）；FAIL/SUGGEST 意见必填；写逐人结果并聚合。 */
export async function judgeReviewCase(
  projectId: string, reviewId: string, caseId: string, userId: string,
  input: { result: 'PASS' | 'FAIL' | 'SUGGEST'; comment: string },
) {
  const r = await loadReview(projectId, reviewId);
  requireNotEnded(r.status);
  const reviewers = (r.reviewers ?? []) as string[];
  if (!reviewers.includes(userId)) throw new DomainError(ErrCode.FORBIDDEN, '仅评审人可标记');
  if ((input.result === 'FAIL' || input.result === 'SUGGEST') && !input.comment.trim()) {
    throw new DomainError(ErrCode.VALIDATION_FAILED, '失败/建议必须填写评审意见');
  }
  const rc = await prisma.reviewCase.findFirst({ where: { reviewId, caseId }, select: { id: true, results: true } });
  if (!rc) throw new DomainError(ErrCode.CASE_NOT_FOUND, '该用例不在评审中');
  const results = ((rc.results ?? []) as { userId: string; result: string; comment: string; ts: string }[])
    .filter((x) => x.userId !== userId);
  results.push({ userId, result: input.result, comment: input.comment, ts: new Date().toISOString() });
  const aggregated = aggregateReviewResult(
    r.reviewMode as 'SINGLE' | 'MULTI',
    reviewers,
    results.map((x) => ({ userId: x.userId, result: x.result as 'PASS' | 'FAIL' | 'SUGGEST' })),
  );
  await prisma.reviewCase.update({
    where: { id: rc.id },
    data: { results, result: aggregated, reviewer: userId, commentedAt: new Date() },
  });
  return { caseId, result: aggregated };
}

/** 批量标记 / 批量改评审人。 */
export async function batchJudge(projectId: string, reviewId: string, userId: string, caseIds: string[], input: { result: 'PASS' | 'FAIL' | 'SUGGEST'; comment: string }) {
  const out: { caseId: string; result: string }[] = [];
  for (const caseId of caseIds) {
    out.push(await judgeReviewCase(projectId, reviewId, caseId, userId, input));
  }
  return { items: out };
}

export async function batchReviewer(projectId: string, reviewId: string, caseIds: string[], reviewer: string) {
  const r = await loadReview(projectId, reviewId);
  requireNotEnded(r.status);
  const reviewers = ((r.reviewers ?? []) as string[]);
  if (!reviewers.includes(reviewer)) throw new DomainError(ErrCode.VALIDATION_FAILED, '目标用户不是该评审的评审人');
  await prisma.reviewCase.updateMany({ where: { reviewId, caseId: { in: caseIds } }, data: { reviewers: [reviewer] } });
  return { affected: caseIds.length };
}

/** 复制评审：名称+copy、关联与评审人复制、结果全部重置；关注不复制。 */
export async function copyReview(projectId: string, reviewId: string) {
  const r = await loadReview(projectId, reviewId);
  const cases = await prisma.reviewCase.findMany({ where: { reviewId }, select: { caseId: true } });
  const copy = await prisma.caseReview.create({
    data: {
      projectId, name: `${r.name}_copy`,
      reviewMode: r.reviewMode, reviewers: toJson(r.reviewers),
      startAt: r.startAt, endAt: r.endAt, createdBy: r.name ? '' : '',
    },
    select: { id: true },
  });
  for (const c of cases) {
    await prisma.reviewCase.create({
      data: { reviewId: copy.id, caseId: c.caseId, reviewers: r.reviewers as string[], result: 'PENDING', results: [] },
    });
  }
  return copy;
}

/** 结束评审：只读（写端点 422 code 10007）。 */
export async function closeReview(projectId: string, reviewId: string) {
  const r = await loadReview(projectId, reviewId);
  requireNotEnded(r.status);
  await prisma.caseReview.update({ where: { id: reviewId }, data: { status: 'ENDED' } });
  return { id: reviewId, status: 'ENDED' };
}

/** 重新提审（CASE-005 §2）：用例白名单字段变更触发；受项目应用设置开关控制。 */
export async function onCaseUpdated(projectId: string, caseId: string): Promise<void> {
  const setting = await prisma.appSetting.findUnique({
    where: { projectId_key: { projectId, key: 'case_review.re_submit' } },
  });
  const enabled = (setting?.value as { enabled?: boolean } | null)?.enabled ?? true; // 默认开启
  if (!enabled) return;
  const underway = await prisma.caseReview.findMany({
    where: { projectId, status: 'UNDERWAY', deletedAt: null },
    select: { id: true, reviewers: true },
  });
  for (const review of underway) {
    await prisma.reviewCase.updateMany({
      where: { reviewId: review.id, caseId },
      data: { result: 'PENDING', results: [], reSubmit: true, reviewers: toJson(review.reviewers ?? []) },
    });
  }
}

// ── 项目应用设置：case_review.re_submit 开关 ──

export async function getReviewSetting(projectId: string) {
  const setting = await prisma.appSetting.findUnique({
    where: { projectId_key: { projectId, key: 'case_review.re_submit' } },
  });
  return { reSubmitEnabled: (setting?.value as { enabled?: boolean } | null)?.enabled ?? true };
}

export async function setReviewSetting(projectId: string, enabled: boolean) {
  await prisma.appSetting.upsert({
    where: { projectId_key: { projectId, key: 'case_review.re_submit' } },
    update: { value: { enabled } },
    create: { projectId, key: 'case_review.re_submit', value: { enabled } },
  });
  return { reSubmitEnabled: enabled };
}
