/** CASE-002：用例 CRUD v2（模块/模板/动态字段）+ 列表全字段筛选 + 复制/关注/批量。 */
import { DomainError, ErrCode } from '@rabbit/shared';
import type { CaseListQueryV2, CaseBatchInput } from '@rabbit/shared';
import { buildValidator, type TemplateFieldBinding } from '@rabbit/shared';
import { prisma } from '@rabbit/db';
import { subtreeIds } from './module.service';
import type { Prisma } from '@rabbit/db';
import type { FieldDefInput } from '@rabbit/shared';

const toJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v ?? {})) as Prisma.InputJsonValue;

const caseSelect = {
  id: true, num: true, name: true, precondition: true, steps: true, level: true, status: true,
  tags: true, moduleId: true, templateId: true, fields: true, version: true,
  deletedAt: true, createdBy: true, createdAt: true, updatedAt: true,
} as const;

type CaseRow = {
  id: string; num: number; name: string; precondition: string; steps: unknown; level: string; status: string;
  tags: unknown; moduleId: string; templateId: string | null; fields: unknown; version: number;
  deletedAt: Date | null; createdBy: string; createdAt: Date; updatedAt: Date;
};

function serialize(c: CaseRow) {
  return {
    ...c,
    steps: (c.steps ?? []) as { desc: string; expect: string }[],
    tags: (c.tags ?? []) as string[],
    fields: (c.fields ?? {}) as Record<string, unknown>,
    deletedAt: c.deletedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** 动态字段校验（按生效模板绑定的字段定义）。 */
async function validateFields(
  orgId: string,
  projectId: string,
  scene: 'case' | 'bug',
  fields: Record<string, unknown>,
  templateId?: string,
): Promise<{ templateId: string | null; fields: Record<string, unknown> }> {
  const { effectiveTemplate, fieldDefsForTemplate } = await import('../project/template.service');
  const template = templateId
    ? await prisma.template.findFirst({ where: { id: templateId, orgId }, select: { id: true, fields: true } })
    : await effectiveTemplate(orgId, projectId, scene);
  if (!template) return { templateId: null, fields }; // 无模板场景（未初始化）直接放行
  const defs = (await fieldDefsForTemplate(orgId, scene)) as unknown as FieldDefInput[];
  const bind = (template as { fields?: unknown }).fields as TemplateFieldBinding[] | undefined;
  const validator = buildValidator(defs, bind ?? undefined);
  const merged = { ...applyDefaults(defs, bind ?? []), ...fields };
  const parsed = validator.safeParse(merged);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new DomainError(ErrCode.VALIDATION_FAILED, first ? `自定义字段校验失败：${first.path.join('.')} ${first.message}` : '自定义字段校验失败');
  }
  return { templateId: template.id, fields: parsed.data as Record<string, unknown> };
}

function applyDefaults(
  defs: { key: string; defaultValue?: unknown; required: boolean }[],
  bind: TemplateFieldBinding[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    const b = bind.find((x) => x.fieldKey === d.key);
    if (b === undefined && d.defaultValue !== undefined) out[d.key] = d.defaultValue;
  }
  return out;
}

export async function createCaseV2(projectId: string, orgId: string, userId: string, input: {
  name: string; precondition: string; steps: { desc: string; expect: string }[];
  level: string; tags: string[]; moduleId?: string; templateId?: string; fields: Record<string, unknown>;
}) {
  const { templateId, fields } = await validateFields(orgId, projectId, 'case', input.fields ?? {}, input.templateId);
  return prisma.$transaction(async (tx) => {
    let moduleId = input.moduleId;
    if (!moduleId) {
      const def = await tx.moduleNode.findFirst({ where: { projectId, scene: 'case', isDefault: true }, select: { id: true } });
      if (!def) throw new DomainError(ErrCode.MODULE_NOT_FOUND, '默认模块缺失，请重新初始化项目');
      moduleId = def.id;
    } else {
      const m = await tx.moduleNode.findFirst({ where: { id: moduleId, projectId, scene: 'case' }, select: { id: true } });
      if (!m) throw new DomainError(ErrCode.MODULE_NOT_FOUND, '目标模块不存在');
    }
    const { nextNum } = await import('@rabbit/db');
    const num = await nextNum(tx, 'functional_cases', projectId);
    const created = await tx.functionalCase.create({
      data: {
        projectId, moduleId, num,
        name: input.name, precondition: input.precondition, steps: toJson(input.steps),
        level: input.level, tags: toJson(input.tags), templateId, fields: toJson(fields), createdBy: userId,
      },
      select: caseSelect,
    });
    await tx.changeLog.create({
      data: { entityType: 'functional_case', entityId: created.id, seq: 1, action: 'create', userId, diff: toJson({ after: { name: input.name, level: input.level } }) },
    });
    return serialize(created);
  });
}

const RESUBMIT_FIELDS = ['name', 'steps', 'level', 'fields'] as const; // CASE-005 重新提审白名单

export async function updateCaseV2(projectId: string, orgId: string, userId: string, caseId: string, input: {
  name: string; precondition: string; steps: { desc: string; expect: string }[];
  level: string; tags: string[]; moduleId?: string; templateId?: string; fields: Record<string, unknown>;
  version: number;
}) {
  const existing = await prisma.functionalCase.findFirst({
    where: { id: caseId, projectId, deletedAt: null },
    select: { ...caseSelect, fields: true },
  });
  if (!existing) throw new DomainError(ErrCode.CASE_NOT_FOUND, '用例不存在或已删除');
  if (existing.version !== input.version) throw new DomainError(ErrCode.VERSION_CONFLICT, '内容已被他人修改，请刷新后重试');
  const { templateId, fields } = await validateFields(orgId, projectId, 'case', input.fields ?? {}, input.templateId ?? existing.templateId ?? undefined);
  const updated = await prisma.functionalCase.update({
    where: { id: caseId },
    data: {
      name: input.name, precondition: input.precondition, steps: toJson(input.steps),
      level: input.level, tags: toJson(input.tags), templateId, fields: toJson(fields),
      ...(input.moduleId ? { moduleId: input.moduleId } : {}),
      version: { increment: 1 },
    },
    select: caseSelect,
  });
  // diff 白名单（CASE-003 §2：name/level/steps/tags/module/动态字段）
  const before = serialize(existing as CaseRow);
  const after = serialize(updated as CaseRow);
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const f of ['name', 'level', 'steps', 'tags'] as const) {
    if (JSON.stringify(before[f]) !== JSON.stringify(after[f])) diff[f] = { before: before[f], after: after[f] };
  }
  if (before.moduleId !== after.moduleId) diff.module = { before: before.moduleId, after: after.moduleId };
  const dynKeys = new Set([...Object.keys(before.fields), ...Object.keys(after.fields)]);
  const dynDiff: Record<string, unknown> = {};
  for (const k of dynKeys) {
    if (JSON.stringify(before.fields[k]) !== JSON.stringify(after.fields[k])) dynDiff[k] = { before: before.fields[k], after: after.fields[k] };
  }
  if (Object.keys(dynDiff).length) diff.fields = { before: '…', after: dynDiff };
  await prisma.changeLog.create({
    data: { entityType: 'functional_case', entityId: caseId, seq: updated.version, action: 'update', userId, diff: toJson(diff) },
  });
  // CASE-005 重新提审：白名单字段变更触发（受项目应用设置开关控制）
  const changed = RESUBMIT_FIELDS.filter((f) => f in diff);
  if (changed.length > 0) {
    const { onCaseUpdated } = await import('../review/review.service');
    await onCaseUpdated(projectId, caseId).catch(() => undefined);
  }
  return after;
}

/** 列表 v2：模块（含子级）/标签/状态/创建人/更新区间/动态字段/视图关注创建人。 */
export async function listCasesV2(projectId: string, q: CaseListQueryV2, viewerId: string) {
  const where: Record<string, unknown> = {
    projectId,
    deletedAt: q.recycled ? { not: null } : null,
  };
  if (q.keyword) where.name = { contains: q.keyword, mode: 'insensitive' };
  if (q.level) where.level = q.level;
  if (q.status) where.status = q.status;
  if (q.creator) where.createdBy = q.creator;
  if (q.createdByMe) where.createdBy = viewerId;
  if (q.updatedFrom || q.updatedTo) {
    where.updatedAt = {
      ...(q.updatedFrom ? { gte: new Date(q.updatedFrom) } : {}),
      ...(q.updatedTo ? { lte: new Date(q.updatedTo) } : {}),
    };
  }
  if (q.moduleId) {
    if (q.includeChildren) {
      const ids = await subtreeIds(projectId, 'case', q.moduleId);
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
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(q.fields) as Record<string, unknown>;
    } catch {
      throw new DomainError(ErrCode.VALIDATION_FAILED, 'fields 筛选参数需为合法 JSON');
    }
    const dynFilters: Record<string, unknown>[] = [];
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        for (const v of value) dynFilters.push({ fields: { path: [key], equals: v } });
      } else {
        dynFilters.push({ fields: { path: [key], equals: value } });
      }
    }
    if (dynFilters.length) where.AND = [...(Array.isArray(where.AND) ? where.AND : []), ...dynFilters];
  }
  if (q.followedBy) {
    // 我关注的：follow 横切表（服务端强制按登录用户）
    const follows = await prisma.follow.findMany({
      where: { userId: viewerId, entityType: 'functional_case' },
      select: { entityId: true },
    });
    const ids = follows.map((f) => f.entityId);
    where.id = { in: ids };
  }
  const [total, items] = await Promise.all([
    prisma.functionalCase.count({ where }),
    prisma.functionalCase.findMany({
      where,
      orderBy: q.orderBy === 'num' ? { num: q.order } : q.orderBy === 'name' ? { name: q.order } : { updatedAt: q.order },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: caseSelect,
    }),
  ]);
  return { total, items: (items as CaseRow[]).map(serialize) };
}

export async function getCaseV2(projectId: string, caseId: string) {
  const c = await prisma.functionalCase.findFirst({
    where: { id: caseId, projectId, deletedAt: null },
    select: caseSelect,
  });
  if (!c) throw new DomainError(ErrCode.CASE_NOT_FOUND, '用例不存在或已删除');
  const row = c as CaseRow;
  const following = await prisma.follow.findFirst({
    where: { userId: undefined as unknown as string, entityType: 'functional_case', entityId: caseId },
    select: { id: true },
  }).catch(() => null);
  void following;
  return serialize(row);
}

/** 复制：名称 +_copy、新 num、状态草稿、字段深拷贝；关联关系不复制（CASE-002 §2）。 */
export async function copyCase(projectId: string, userId: string, caseId: string) {
  const src = await prisma.functionalCase.findFirst({
    where: { id: caseId, projectId, deletedAt: null },
    select: caseSelect,
  });
  if (!src) throw new DomainError(ErrCode.CASE_NOT_FOUND, '用例不存在或已删除');
  return prisma.$transaction(async (tx) => {
    const { nextNum } = await import('@rabbit/db');
    const num = await nextNum(tx, 'functional_cases', projectId);
    const created = await tx.functionalCase.create({
      data: {
        projectId, moduleId: src.moduleId, num,
        name: `${src.name}_copy`, precondition: src.precondition, steps: src.steps as object,
        level: src.level, status: 'PREPARING', tags: src.tags as string[],
        templateId: src.templateId, fields: src.fields as object, createdBy: userId,
      },
      select: { id: true, num: true, name: true },
    });
    return created;
  });
}

export async function setFollow(projectId: string, userId: string, caseId: string, on: boolean) {
  const c = await prisma.functionalCase.findFirst({ where: { id: caseId, projectId }, select: { id: true } });
  if (!c) throw new DomainError(ErrCode.CASE_NOT_FOUND, '用例不存在');
  if (on) {
    await prisma.follow.upsert({
      where: { userId_entityType_entityId: { userId, entityType: 'functional_case', entityId: caseId } },
      update: {},
      create: { userId, entityType: 'functional_case', entityId: caseId },
    });
  } else {
    await prisma.follow.deleteMany({ where: { userId, entityType: 'functional_case', entityId: caseId } });
  }
  return { following: on };
}

export async function listFollowedCaseIds(userId: string): Promise<string[]> {
  const follows = await prisma.follow.findMany({ where: { userId, entityType: 'functional_case' }, select: { entityId: true } });
  return follows.map((f) => f.entityId);
}

/** 批量：move/copy/delete/update（等级/标签增删）。 */
export async function batchCases(projectId: string, orgId: string, userId: string, action: 'move' | 'copy' | 'delete' | 'update', input: CaseBatchInput) {
  const targets = await prisma.functionalCase.findMany({
    where: { id: { in: input.ids }, projectId, deletedAt: null },
    select: { id: true },
  });
  if (targets.length === 0) throw new DomainError(ErrCode.CASE_NOT_FOUND, '未命中任何用例');
  const ids = targets.map((t) => t.id);
  switch (action) {
    case 'move': {
      if (!input.moduleId) throw new DomainError(ErrCode.VALIDATION_FAILED, '缺少目标模块');
      const m = await prisma.moduleNode.findFirst({ where: { id: input.moduleId, projectId, scene: 'case' }, select: { id: true } });
      if (!m) throw new DomainError(ErrCode.MODULE_NOT_FOUND, '目标模块不存在');
      const r = await prisma.functionalCase.updateMany({ where: { id: { in: ids } }, data: { moduleId: input.moduleId } });
      return { affected: r.count };
    }
    case 'copy': {
      let count = 0;
      for (const id of ids) {
        await copyCase(projectId, userId, id);
        count += 1;
      }
      return { affected: count };
    }
    case 'delete': {
      const r = await prisma.functionalCase.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
      return { affected: r.count };
    }
    case 'update': {
      const data: Record<string, unknown> = {};
      if (input.level) data.level = input.level;
      const existing = await prisma.functionalCase.findMany({ where: { id: { in: ids } }, select: { id: true, tags: true } });
      if (input.addTags?.length || input.removeTags?.length) {
        for (const c of existing) {
          const tags = new Set((c.tags as string[]) ?? []);
          for (const t of input.addTags ?? []) tags.add(t);
          for (const t of input.removeTags ?? []) tags.delete(t);
          await prisma.functionalCase.update({ where: { id: c.id }, data: { ...(input.level ? { level: input.level } : {}), tags: [...tags] } });
        }
        return { affected: existing.length };
      }
      if (Object.keys(data).length === 0) throw new DomainError(ErrCode.VALIDATION_FAILED, '缺少批量编辑内容');
      const r = await prisma.functionalCase.updateMany({ where: { id: { in: ids } }, data });
      return { affected: r.count };
    }
    default:
      throw new DomainError(ErrCode.VALIDATION_FAILED, '未知批量操作');
  }
}

export { serialize as serializeCase, caseSelect };

/** 软删（复用 CASE-001 语义，挂到 v2 服务供路由统一导入）。 */
export async function deleteCaseV2(projectId: string, caseId: string, userId: string) {
  const { softDeleteCase } = await import('./case.service');
  return softDeleteCase(projectId, caseId, userId);
}
