/** BUG-001：本地缺陷——模板创建、工作流流转、列表、回收站、关联用例、附件、统计口径。 */
import { DomainError, ErrCode, buildValidator } from '@rabbit/shared';
import type { FieldDefInput, TemplateFieldBinding } from '@rabbit/shared';
import type { Prisma } from '@rabbit/db';

const toJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v ?? {})) as Prisma.InputJsonValue;
import { prisma } from '@rabbit/db';
import { subtreeIds } from '../case/module.service';

export interface BugUpsertInput {
  title: string;
  description?: string;
  templateId?: string;
  fields?: Record<string, unknown>;
  handleUserId?: string | null;
  moduleId?: string;
  tags?: string[];
  version?: number;
}

/** 当前项目缺陷工作流（状态集 + 结束态 + 允许矩阵）。 */
export async function bugWorkflow(orgId: string, projectId: string) {
  const { getWorkflow } = await import('../project/template.service');
  return getWorkflow(orgId, projectId);
}

export async function pendingCount(projectId: string, orgId: string): Promise<number> {
  const wf = await bugWorkflow(orgId, projectId);
  const endSerials = wf.states.filter((s) => s.isEnd).map((s) => s.serial);
  return prisma.bug.count({
    where: { projectId, deletedAt: null, status: { notIn: [...endSerials, ''] } },
  });
}

export async function listBugs(projectId: string, q: {
  keyword?: string; status?: string; handler?: string; moduleId?: string; includeChildren?: boolean;
  tags?: string; fields?: string; recycled?: boolean; page: number; pageSize: number;
  orderBy?: string; order?: string;
}) {
  const where: Record<string, unknown> = {
    projectId,
    deletedAt: q.recycled ? { not: null } : null,
  };
  if (q.keyword) where.title = { contains: q.keyword, mode: 'insensitive' };
  if (q.status) where.status = q.status;
  if (q.handler) where.handleUserId = q.handler;
  if (q.moduleId) {
    if (q.includeChildren) {
      const ids = await subtreeIds(projectId, 'bug', q.moduleId);
      where.moduleId = { in: ids };
    } else {
      where.moduleId = q.moduleId;
    }
  }
  if (q.tags) {
    const tags = q.tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (tags.length) where.OR = tags.map((t) => ({ tags: { array_contains: [t] } }));
  }
  if (q.fields) {
    try {
      const parsed = JSON.parse(q.fields) as Record<string, unknown>;
      const dyn: Record<string, unknown>[] = [];
      for (const [k, v] of Object.entries(parsed)) {
        if (Array.isArray(v)) for (const item of v) dyn.push({ fields: { path: [k], equals: item } });
        else dyn.push({ fields: { path: [k], equals: v } });
      }
      if (dyn.length) where.AND = [...(Array.isArray(where.AND) ? where.AND : []), ...dyn];
    } catch {
      throw new DomainError(ErrCode.VALIDATION_FAILED, 'fields 筛选参数需为合法 JSON');
    }
  }
  const [total, items] = await Promise.all([
    prisma.bug.count({ where }),
    prisma.bug.findMany({
      where,
      orderBy: { num: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true, num: true, title: true, status: true, handleUserId: true, moduleId: true,
        tags: true, fields: true, version: true, deletedAt: true, createdAt: true, updatedAt: true, templateId: true,
      },
    }),
  ]);
  return {
    total,
    items: items.map((b) => ({
      ...b,
      tags: (b.tags ?? []) as string[],
      fields: (b.fields ?? {}) as Record<string, unknown>,
      deletedAt: b.deletedAt?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    })),
  };
}

export async function getBug(projectId: string, bugId: string) {
  const b = await prisma.bug.findFirst({
    where: { id: bugId, projectId },
    select: {
      id: true, num: true, title: true, description: true, status: true, handleUserId: true,
      moduleId: true, tags: true, fields: true, templateId: true, platform: true,
      version: true, deletedAt: true, createdBy: true, createdAt: true, updatedAt: true,
    },
  });
  if (!b) throw new DomainError(ErrCode.BUG_NOT_FOUND, '缺陷不存在或已删除');
  return {
    ...b,
    tags: (b.tags ?? []) as string[],
    fields: (b.fields ?? {}) as Record<string, unknown>,
    description: b.description ?? '',
    deletedAt: b.deletedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

export async function createBug(projectId: string, orgId: string, userId: string, input: BugUpsertInput) {
  const { effectiveTemplate, fieldDefsForTemplate } = await import('../project/template.service');
  const template = input.templateId
    ? await prisma.template.findFirst({ where: { id: input.templateId, orgId, scene: 'bug' }, select: { id: true, fields: true } })
    : await effectiveTemplate(orgId, projectId, 'bug');
  let fields = input.fields ?? {};
  if (template) {
    const defs = (await fieldDefsForTemplate(orgId, 'bug')) as unknown as FieldDefInput[];
    const bind = (template as { fields?: unknown }).fields as TemplateFieldBinding[] | undefined;
    const validator = buildValidator(defs, bind ?? undefined);
    const parsed = validator.safeParse(fields);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new DomainError(ErrCode.VALIDATION_FAILED, first ? `自定义字段校验失败：${first.path.join('.')} ${first.message}` : '自定义字段校验失败');
    }
    fields = parsed.data as Record<string, unknown>;
  }
  // 初始工作流状态（start）
  const wf = await bugWorkflow(orgId, projectId);
  const start = wf.states.find((s) => s.isStart) ?? wf.states[0];
  const status = start?.serial ?? '待处理';
  return prisma.$transaction(async (tx) => {
    let moduleId = input.moduleId ?? null;
    if (moduleId) {
      const m = await tx.moduleNode.findFirst({ where: { id: moduleId, projectId, scene: 'bug' }, select: { id: true } });
      if (!m) throw new DomainError(ErrCode.MODULE_NOT_FOUND, '目标模块不存在');
    } else {
      const def = await tx.moduleNode.findFirst({ where: { projectId, scene: 'bug', isDefault: true }, select: { id: true } });
      moduleId = def?.id ?? null;
    }
    const { nextNum } = await import('@rabbit/db');
    const num = await nextNum(tx, 'bugs', projectId);
    const created = await tx.bug.create({
      data: {
        projectId, num, title: input.title, description: input.description ?? '',
        templateId: template?.id ?? null, fields: toJson(fields), status,
        handleUserId: input.handleUserId ?? null, moduleId, tags: toJson(input.tags ?? []), createdBy: userId,
      },
      select: { id: true, num: true, status: true },
    });
    await tx.changeLog.create({
      data: { entityType: 'bug', entityId: created.id, seq: 1, action: 'create', userId, diff: { after: { title: input.title, status } } },
    });
    return created;
  });
}

export async function updateBug(projectId: string, bugId: string, userId: string, input: BugUpsertInput) {
  const existing = await prisma.bug.findFirst({
    where: { id: bugId, projectId, deletedAt: null },
    select: { id: true, version: true, title: true, description: true, fields: true, tags: true, handleUserId: true, moduleId: true, templateId: true },
  });
  if (!existing) throw new DomainError(ErrCode.BUG_NOT_FOUND, '缺陷不存在或已删除');
  if (input.version !== undefined && input.version !== existing.version) {
    throw new DomainError(ErrCode.VERSION_CONFLICT, '内容已被他人修改，请刷新后重试');
  }
  const updated = await prisma.bug.update({
    where: { id: bugId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.fields !== undefined ? { fields: toJson(input.fields) } : {}),
      ...(input.tags !== undefined ? { tags: toJson(input.tags) } : {}),
      ...(input.handleUserId !== undefined ? { handleUserId: input.handleUserId } : {}),
      ...(input.moduleId !== undefined ? { moduleId: input.moduleId } : {}),
      version: { increment: 1 },
    },
    select: { id: true, version: true },
  });
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  if (input.title !== undefined && input.title !== existing.title) diff.title = { before: existing.title, after: input.title };
  if (input.handleUserId !== undefined && input.handleUserId !== existing.handleUserId) diff.handleUser = { before: existing.handleUserId, after: input.handleUserId };
  const seq = (await prisma.changeLog.count({ where: { entityType: 'bug', entityId: bugId } })) + 1;
  await prisma.changeLog.create({
    data: { entityType: 'bug', entityId: bugId, seq, action: 'update', userId, diff: toJson(diff) },
  });
  return updated;
}

/** 工作流流转：Transition(from,to) 白名单，否则 422 code 10006；可附评论。 */
export async function transitionBug(
  projectId: string, orgId: string, bugId: string, userId: string,
  input: { toState: string; comment?: string },
) {
  const bug = await prisma.bug.findFirst({
    where: { id: bugId, projectId, deletedAt: null },
    select: { id: true, status: true, templateId: true },
  });
  if (!bug) throw new DomainError(ErrCode.BUG_NOT_FOUND, '缺陷不存在或已删除');
  const wf = await bugWorkflow(orgId, projectId);
  const allowed = wf.transitions.some((t) => t.from === bug.status && t.to === input.toState);
  if (!allowed) throw new DomainError(ErrCode.WORKFLOW_DENIED, `不允许的流转：${bug.status} → ${input.toState}`);
  await prisma.bug.update({ where: { id: bugId }, data: { status: input.toState, version: { increment: 1 } } });
  const seq = (await prisma.changeLog.count({ where: { entityType: 'bug', entityId: bugId } })) + 1;
  await prisma.changeLog.create({
    data: {
      entityType: 'bug', entityId: bugId, seq, action: 'transition', userId,
      diff: toJson({ from: bug.status, to: input.toState, comment: input.comment ?? '' }),
    },
  });
  if (input.comment?.trim()) {
    await prisma.comment.create({
      data: { userId, entityType: 'bug', entityId: bugId, content: `【流转 ${bug.status}→${input.toState}】${input.comment}` },
    });
  }
  return { id: bugId, status: input.toState };
}

/** 允许的目标状态（详情页流转按钮组）。 */
export async function allowedTransitions(projectId: string, orgId: string, currentStatus: string): Promise<string[]> {
  const wf = await bugWorkflow(orgId, projectId);
  return wf.transitions.filter((t) => t.from === currentStatus).map((t) => t.to);
}

export async function softDeleteBug(projectId: string, bugId: string) {
  const r = await prisma.bug.updateMany({ where: { id: bugId, projectId, deletedAt: null }, data: { deletedAt: new Date() } });
  if (r.count === 0) throw new DomainError(ErrCode.BUG_NOT_FOUND, '缺陷不存在或已在回收站');
  return { ok: true };
}

export async function restoreBug(projectId: string, bugId: string) {
  const r = await prisma.bug.updateMany({ where: { id: bugId, projectId, deletedAt: { not: null } }, data: { deletedAt: null } });
  if (r.count === 0) throw new DomainError(ErrCode.BUG_NOT_FOUND, '缺陷不在回收站');
  return { ok: true };
}

export async function purgeBug(projectId: string, bugId: string) {
  const b = await prisma.bug.findFirst({ where: { id: bugId, projectId, deletedAt: { not: null } }, select: { id: true } });
  if (!b) throw new DomainError(ErrCode.BUG_NOT_FOUND, '缺陷不在回收站');
  await prisma.$transaction(async (tx) => {
    await tx.bugCaseRef.deleteMany({ where: { bugId } });
    await tx.comment.deleteMany({ where: { entityType: 'bug', entityId: bugId } });
    await tx.changeLog.deleteMany({ where: { entityType: 'bug', entityId: bugId } });
    await tx.follow.deleteMany({ where: { entityType: 'bug', entityId: bugId } });
    await tx.attachment.deleteMany({ where: { entityType: 'bug', entityId: bugId } });
    await tx.bug.delete({ where: { id: bugId } });
  });
  return { ok: true };
}

// ── 关联用例 ──

export async function listBugCases(projectId: string, bugId: string) {
  const refs = await prisma.bugCaseRef.findMany({ where: { bugId, refType: 'functional_case' } });
  const caseIds = refs.map((r) => r.refId);
  const cases = caseIds.length
    ? await prisma.functionalCase.findMany({ where: { id: { in: caseIds }, projectId, deletedAt: null }, select: { id: true, num: true, name: true, level: true } })
    : [];
  return cases.map((c) => ({ caseId: c.id, num: c.num, name: c.name, level: c.level }));
}

export async function linkBugCase(projectId: string, bugId: string, caseId: string) {
  const { linkCaseBug } = await import('../case/caseDetail.service');
  return linkCaseBug(projectId, caseId, bugId);
}

export async function unlinkBugCase(projectId: string, bugId: string, caseId: string) {
  const { unlinkCaseBug } = await import('../case/caseDetail.service');
  return unlinkCaseBug(projectId, caseId, bugId);
}

// ── 附件 ──

export async function addAttachment(projectId: string, userId: string, entityType: string, entityId: string, file: { name: string; mime?: string; size: number; buffer: Buffer }) {
  const { fileMaxSizeMb } = await import('../system/param.service');
  const { isBlockedName, putObject } = await import('@/server/storage');
  const limitMb = await fileMaxSizeMb();
  if (file.size > limitMb * 1024 * 1024) {
    throw new DomainError(ErrCode.VALIDATION_FAILED, `附件超过大小上限 ${limitMb}MB`);
  }
  if (isBlockedName(file.name)) {
    throw new DomainError(ErrCode.VALIDATION_FAILED, '不允许上传可执行文件');
  }
  const storageKey = await putObject(file.buffer);
  return prisma.attachment.create({
    data: {
      projectId, entityType, entityId, name: file.name, storageKey,
      size: file.size, mime: file.mime ?? 'application/octet-stream', createdBy: userId,
    },
    select: { id: true, name: true, size: true },
  });
}

export async function listAttachments(entityType: string, entityId: string) {
  const rows = await prisma.attachment.findMany({
    where: { entityType, entityId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, size: true, mime: true, createdAt: true },
  });
  return rows.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }));
}

export async function getAttachment(projectId: string, attachmentId: string) {
  const a = await prisma.attachment.findFirst({ where: { id: attachmentId, projectId, deletedAt: null } });
  if (!a) throw new DomainError(ErrCode.VALIDATION_FAILED, '附件不存在');
  return a;
}

export async function deleteAttachment(projectId: string, attachmentId: string) {
  const a = await getAttachment(projectId, attachmentId);
  const { deleteObject } = await import('@/server/storage');
  await deleteObject(a.storageKey);
  await prisma.attachment.delete({ where: { id: attachmentId } });
  return { ok: true };
}

// ── 变更历史（含 create/update/transition；CASE-003 时间线复用）──
export async function listBugChanges(projectId: string, bugId: string) {
  const bug = await prisma.bug.findFirst({ where: { id: bugId, projectId }, select: { id: true } });
  if (!bug) throw new DomainError(ErrCode.BUG_NOT_FOUND, '缺陷不存在或已删除');
  const { listChanges } = await import('../case/caseDetail.service');
  return listChanges('bug', bugId);
}

// ── 关注（与用例同构，entityType=bug）──

export async function setBugFollow(projectId: string, userId: string, bugId: string, on: boolean) {
  const b = await prisma.bug.findFirst({ where: { id: bugId, projectId }, select: { id: true } });
  if (!b) throw new DomainError(ErrCode.BUG_NOT_FOUND, '缺陷不存在');
  if (on) {
    await prisma.follow.upsert({
      where: { userId_entityType_entityId: { userId, entityType: 'bug', entityId: bugId } },
      update: {},
      create: { userId, entityType: 'bug', entityId: bugId },
    });
  } else {
    await prisma.follow.deleteMany({ where: { userId, entityType: 'bug', entityId: bugId } });
  }
  return { following: on };
}
