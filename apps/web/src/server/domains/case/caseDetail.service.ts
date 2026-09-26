/** CASE-003：依赖关系（双向）、评审/计划/缺陷关联聚合、评论横切、变更历史时间线。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import { prisma } from "@rabbit/db";

// ── 依赖关系 ──

export async function listDependencies(projectId: string, caseId: string) {
  const c = await prisma.functionalCase.findFirst({
    where: { id: caseId, projectId, deletedAt: null },
    select: { id: true },
  });
  if (!c) throw new DomainError(ErrCode.CASE_NOT_FOUND, "用例不存在或已删除");
  const [preRefs, postRefs] = await Promise.all([
    prisma.caseDependency.findMany({ where: { postCaseId: caseId } }),
    prisma.caseDependency.findMany({ where: { preCaseId: caseId } }),
  ]);
  const ids = [
    ...new Set([...preRefs.map((d) => d.preCaseId), ...postRefs.map((d) => d.postCaseId)]),
  ];
  const cases = ids.length
    ? await prisma.functionalCase.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, num: true, name: true, level: true },
      })
    : [];
  const caseMap = new Map(cases.map((c) => [c.id, c]));
  return {
    pre: preRefs
      .filter((d) => caseMap.has(d.preCaseId))
      .map((d) => ({ id: d.id, case: caseMap.get(d.preCaseId)! })),
    post: postRefs
      .filter((d) => caseMap.has(d.postCaseId))
      .map((d) => ({ id: d.id, case: caseMap.get(d.postCaseId)! })),
  };
}

export async function addDependency(projectId: string, preCaseId: string, postCaseId: string) {
  if (preCaseId === postCaseId) throw new DomainError(ErrCode.VALIDATION_FAILED, "不能依赖自身");
  const cases = await prisma.functionalCase.findMany({
    where: { id: { in: [preCaseId, postCaseId] }, projectId, deletedAt: null },
    select: { id: true },
  });
  if (cases.length !== 2) throw new DomainError(ErrCode.CASE_NOT_FOUND, "用例不存在或已删除");
  const dup = await prisma.caseDependency.findFirst({
    where: { preCaseId, postCaseId },
    select: { id: true },
  });
  if (dup) throw new DomainError(ErrCode.VALIDATION_FAILED, "依赖关系已存在");
  return prisma.caseDependency.create({ data: { preCaseId, postCaseId }, select: { id: true } });
}

export async function removeDependency(projectId: string, id: string) {
  const dep = await prisma.caseDependency.findFirst({
    where: { id },
    select: { id: true, preCaseId: true, postCaseId: true },
  });
  if (!dep) throw new DomainError(ErrCode.VALIDATION_FAILED, "依赖不存在");
  const belongs = await prisma.functionalCase.count({
    where: { id: { in: [dep.preCaseId, dep.postCaseId] }, projectId },
  });
  if (belongs === 0) throw new DomainError(ErrCode.CASE_NOT_FOUND, "用例不存在或无权访问");
  await prisma.caseDependency.delete({ where: { id } });
  return { ok: true };
}

// ── 关联聚合（评审 / 计划 / 缺陷）──

export async function caseReviews(projectId: string, caseId: string) {
  const rows = await prisma.reviewCase.findMany({
    where: { caseId, review: { projectId, deletedAt: null } },
    orderBy: { id: "desc" },
    include: {
      review: {
        select: {
          id: true,
          name: true,
          status: true,
          reviewMode: true,
          startAt: true,
          endAt: true,
        },
      },
    },
  });
  return rows.map((r) => ({
    reviewId: r.review.id,
    name: r.review.name,
    status: r.review.status,
    result: r.result,
    reSubmit: r.reSubmit,
    startAt: r.review.startAt?.toISOString() ?? null,
    endAt: r.review.endAt?.toISOString() ?? null,
  }));
}

export async function casePlans(projectId: string, caseId: string, viewerId: string) {
  const refs = await prisma.planCaseRef.findMany({
    where: { refType: "functional_case", refId: caseId, plan: { projectId, deletedAt: null } },
    include: { plan: { select: { id: true, name: true, status: true, archivedAt: true } } },
  });
  return refs.map((r) => ({
    planId: r.plan.id,
    name: r.plan.name,
    planStatus: r.plan.status,
    archived: Boolean(r.plan.archivedAt),
    myExecStatus: r.execUserId === viewerId ? r.status : null,
    executor: r.execUserId,
  }));
}

export async function caseBugs(projectId: string, caseId: string) {
  const refs = await prisma.bugCaseRef.findMany({
    where: { refType: "functional_case", refId: caseId },
  });
  const bugIds = refs.map((r) => r.bugId);
  const bugs = bugIds.length
    ? await prisma.bug.findMany({
        where: { id: { in: bugIds }, projectId, deletedAt: null },
        select: { id: true, num: true, title: true, status: true },
      })
    : [];
  return bugs.map((b) => ({ bugId: b.id, num: b.num, title: b.title, status: b.status }));
}

/** 用例 ↔ 缺陷关联（CASE-003 缺陷 Tab / BUG-001 关联用例共用）。 */
export async function linkCaseBug(projectId: string, caseId: string, bugId: string) {
  const [c, b] = await Promise.all([
    prisma.functionalCase.findFirst({
      where: { id: caseId, projectId, deletedAt: null },
      select: { id: true },
    }),
    prisma.bug.findFirst({
      where: { id: bugId, projectId, deletedAt: null },
      select: { id: true },
    }),
  ]);
  if (!c) throw new DomainError(ErrCode.CASE_NOT_FOUND, "用例不存在或已删除");
  if (!b) throw new DomainError(ErrCode.BUG_NOT_FOUND, "缺陷不存在或已删除");
  await prisma.bugCaseRef.upsert({
    where: { bugId_refType_refId: { bugId, refType: "functional_case", refId: caseId } },
    update: {},
    create: { bugId, refType: "functional_case", refId: caseId },
  });
  return { ok: true };
}

export async function unlinkCaseBug(projectId: string, caseId: string, bugId: string) {
  const r = await prisma.bugCaseRef.deleteMany({
    where: { bugId, refType: "functional_case", refId: caseId },
  });
  if (r.count === 0) throw new DomainError(ErrCode.VALIDATION_FAILED, "关联不存在");
  return { ok: true };
}

// ── 评论横切（entityType=case:{id} / bug:{id}，bug 详情复用）──

export async function listComments(entityType: string, entityId: string) {
  const rows = await prisma.comment.findMany({
    where: { entityType, entityId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  return rows.map((c) => ({
    id: c.id,
    content: c.content,
    parentId: c.parentId,
    userId: c.userId,
    userName: c.user.name,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));
}

export async function addComment(
  userId: string,
  entityType: string,
  entityId: string,
  content: string,
  parentId?: string,
) {
  return prisma.comment.create({
    data: { userId, entityType, entityId, content, parentId: parentId ?? null },
    select: { id: true },
  });
}

export async function updateComment(
  userId: string,
  canModerate: boolean,
  commentId: string,
  content: string,
) {
  const c = await prisma.comment.findFirst({
    where: { id: commentId, deletedAt: null },
    select: { id: true, userId: true },
  });
  if (!c) throw new DomainError(ErrCode.VALIDATION_FAILED, "评论不存在");
  if (c.userId !== userId && !canModerate)
    throw new DomainError(ErrCode.FORBIDDEN, "仅作者或项目管理员可操作该评论");
  await prisma.comment.update({ where: { id: commentId }, data: { content } });
  return { id: commentId };
}

export async function deleteComment(userId: string, canModerate: boolean, commentId: string) {
  const c = await prisma.comment.findFirst({
    where: { id: commentId, deletedAt: null },
    select: { id: true, userId: true },
  });
  if (!c) throw new DomainError(ErrCode.VALIDATION_FAILED, "评论不存在");
  if (c.userId !== userId && !canModerate)
    throw new DomainError(ErrCode.FORBIDDEN, "仅作者或项目管理员可操作该评论");
  await prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
  return { ok: true };
}

// ── 变更历史（CASE-003 时间线；bug 复用）──

export async function listChanges(entityType: string, entityId: string) {
  const rows = await prisma.changeLog.findMany({
    where: { entityType, entityId },
    orderBy: { seq: "asc" },
    include: { user: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    action: r.action,
    diff: r.diff,
    userName: r.user?.name ?? "系统",
    createdAt: r.createdAt.toISOString(),
  }));
}

/** 下一变更序号（乐观自增，复用 nextNum 语义）。 */
export async function nextSeq(
  tx: {
    changeLog: {
      count: (a: { where: { entityType: string; entityId: string } }) => Promise<number>;
    };
  },
  entityType: string,
  entityId: string,
): Promise<number> {
  // seq 取 max+1 简化（唯一约束 (entity, id, seq) 下 count+1 在低并发编辑场景足够；高并发由唯一约束兜底重试）
  return (await tx.changeLog.count({ where: { entityType, entityId } })) + 1;
}
