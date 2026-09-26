/** PROJ-002：字段定义、两级模板（项目模板不可逆开关）、缺陷工作流（状态+流转矩阵）。 */
import { DomainError, ErrCode, BUG_TEMPLATE_LIMIT } from '@rabbit/shared';
import type { FieldDefUpsertInput, TemplateUpsertInput } from '@rabbit/shared';
import { prisma } from '@rabbit/db';
import type { Prisma } from '@rabbit/db';

const toJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v ?? {})) as Prisma.InputJsonValue;

// ── 字段定义（org 级；类型不可改；存量引用时软停用优先）──

export async function listFieldDefs(orgId: string, scene?: string) {
  const defs = await prisma.fieldDef.findMany({
    where: { orgId, ...(scene ? { scene } : {}) },
    orderBy: [{ scene: 'asc' }, { createdAt: 'asc' }],
  });
  return defs.map((d) => ({
    id: d.id, scene: d.scene, name: d.name, key: d.key, type: d.type,
    required: d.required, options: d.options as Record<string, unknown>,
    isSystem: d.isSystem, enabled: !('enabled' in (d.options as object)) ? true : Boolean((d.options as { enabled?: boolean }).enabled),
    createdAt: d.createdAt.toISOString(),
  }));
}

export async function createFieldDef(orgId: string, input: FieldDefUpsertInput) {
  const dup = await prisma.fieldDef.findFirst({ where: { orgId, scene: input.scene, key: input.key }, select: { id: true } });
  if (dup) throw new DomainError(ErrCode.VALIDATION_FAILED, `字段标识 ${input.key} 已存在`);
  const d = await prisma.fieldDef.create({
    data: {
      orgId, scene: input.scene, name: input.name, key: input.key, type: input.type,
      required: input.required,
      options: { ...input.options, enabled: input.enabled, defaultValue: input.defaultValue ?? null },
    },
    select: { id: true, key: true },
  });
  return d;
}

export async function updateFieldDef(orgId: string, id: string, input: FieldDefUpsertInput) {
  const existing = await prisma.fieldDef.findFirst({ where: { id, orgId }, select: { id: true, type: true, key: true } });
  if (!existing) throw new DomainError(ErrCode.VALIDATION_FAILED, '字段不存在');
  if (existing.type !== input.type) throw new DomainError(ErrCode.VALIDATION_FAILED, '字段类型不可变更（停用后新建）');
  if (existing.key !== input.key) throw new DomainError(ErrCode.VALIDATION_FAILED, '字段标识不可变更');
  return prisma.fieldDef.update({
    where: { id },
    data: {
      name: input.name, required: input.required,
      options: { ...input.options, enabled: input.enabled, defaultValue: input.defaultValue ?? null },
    },
    select: { id: true },
  });
}

/** 删除：有存量实例值 → 软停用（数据保留，表单不再展示）。 */
export async function deleteFieldDef(orgId: string, id: string) {
  const existing = await prisma.fieldDef.findFirst({ where: { id, orgId }, select: { id: true, key: true, scene: true, options: true } });
  if (!existing) throw new DomainError(ErrCode.VALIDATION_FAILED, '字段不存在');
  const rowsUsed = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM ${existing.scene === 'bug' ? 'bugs' : 'functional_cases'} WHERE fields ? $1`,
    existing.key,
  );
  const usedCount = Number((rowsUsed as { n: number }[])[0]?.n ?? 0);
  if (usedCount > 0) {
    await prisma.fieldDef.update({
      where: { id },
      data: { options: { ...(existing.options as object), enabled: false } },
    });
    return { softDisabled: true, usedCount };
  }
  await prisma.fieldDef.delete({ where: { id } });
  return { softDisabled: false, usedCount: 0 };
}

// ── 模板（两级；项目模板模式不可逆）──

async function templateModeEnabled(projectId: string | null): Promise<boolean> {
  const setting = projectId
    ? await prisma.appSetting.findUnique({ where: { projectId_key: { projectId, key: 'template.mode' } } })
    : null;
  return Boolean((setting?.value as { enabled?: boolean } | null)?.enabled);
}

/** 生效模板集：项目模板模式开启 → 项目模板；否则组织模板。 */
async function effectiveWhere(orgId: string, projectId: string | null, scene?: string) {
  const projectMode = projectId ? await templateModeEnabled(projectId) : false;
  return {
    orgId,
    ...(projectMode && projectId ? { projectId } : { projectId: null }),
    ...(scene ? { scene } : {}),
  };
}

export async function listTemplates(orgId: string, projectId: string | null, scene?: string) {
  const where = await effectiveWhere(orgId, projectId, scene);
  const templates = await prisma.template.findMany({ where, orderBy: [{ scene: 'asc' }, { createdAt: 'asc' }] });
  const ids = templates.map((t) => t.id);
  const bugCounts = ids.length
    ? await prisma.bug.groupBy({ by: ['templateId'], where: { templateId: { in: ids } }, _count: { _all: true } })
    : [];
  const caseCounts = ids.length
    ? await prisma.functionalCase.groupBy({ by: ['templateId'], where: { templateId: { in: ids } }, _count: { _all: true } })
    : [];
  const countMap = new Map<string, number>();
  for (const r of [...bugCounts, ...caseCounts]) {
    if (r.templateId) countMap.set(r.templateId, (countMap.get(r.templateId) ?? 0) + (r._count as { _all: number })._all);
  }
  return templates.map((t) => ({
    id: t.id, scene: t.scene, name: t.name, isDefault: t.isDefault, isSystem: t.isSystem,
    fields: t.fields as { fieldKey: string; required?: boolean; visibleInList?: boolean }[],
    refCount: countMap.get(t.id) ?? 0,
    projectMode: where.projectId !== null,
    createdAt: t.createdAt.toISOString(),
  }));
}

export async function createTemplate(orgId: string, projectId: string | null, actorId: string, input: TemplateUpsertInput) {
  const projectMode = await templateModeEnabled(projectId);
  if (input.scene === 'bug') {
    const where = await effectiveWhere(orgId, projectId, 'bug');
    const count = await prisma.template.count({ where });
    if (count >= BUG_TEMPLATE_LIMIT) throw new DomainError(ErrCode.VALIDATION_FAILED, `缺陷模板上限 ${BUG_TEMPLATE_LIMIT} 个`);
  }
  const t = await prisma.template.create({
    data: {
      orgId, projectId: projectMode ? projectId : null, scene: input.scene,
      name: input.name, fields: input.fields,
    },
    select: { id: true, scene: true },
  });
  // 缺陷模板：初始化一份默认工作流（拷贝当前默认模板的状态机）
  if (input.scene === 'bug') {
    const where = await effectiveWhere(orgId, projectId, 'bug');
    const def = await prisma.template.findFirst({ where: { ...where, isDefault: true }, select: { id: true } });
    if (def) await copyWorkflow(def.id, t.id);
    else await seedDefaultWorkflow(t.id);
  }
  void actorId;
  return t;
}

export async function updateTemplate(orgId: string, id: string, input: { name?: string }) {
  const existing = await prisma.template.findFirst({ where: { id, orgId }, select: { id: true } });
  if (!existing) throw new DomainError(ErrCode.TEMPLATE_NOT_FOUND, '模板不存在');
  return prisma.template.update({ where: { id }, data: { name: input.name }, select: { id: true, name: true } });
}

/** 绑定与覆写（required / visibleInList）。 */
export async function updateTemplateFields(orgId: string, id: string, fields: TemplateUpsertInput['fields']) {
  const existing = await prisma.template.findFirst({ where: { id, orgId }, select: { id: true, scene: true } });
  if (!existing) throw new DomainError(ErrCode.TEMPLATE_NOT_FOUND, '模板不存在');
  // fieldKey 必须存在于该 scene 的字段定义
  const defs = await prisma.fieldDef.findMany({ where: { orgId, scene: existing.scene }, select: { key: true } });
  const known = new Set(defs.map((d) => d.key));
  const unknown = fields.filter((f) => !known.has(f.fieldKey)).map((f) => f.fieldKey);
  if (unknown.length) throw new DomainError(ErrCode.VALIDATION_FAILED, `未定义的字段：${unknown.join(', ')}`);
  await prisma.template.update({ where: { id }, data: { fields } });
  return { id, fields };
}

/** 设默认：每 scene 恰一（切换即取消前默认）。 */
export async function setDefaultTemplate(orgId: string, projectId: string | null, id: string) {
  const t = await prisma.template.findFirst({ where: { id, orgId }, select: { id: true, scene: true, projectId: true } });
  if (!t) throw new DomainError(ErrCode.TEMPLATE_NOT_FOUND, '模板不存在');
  await prisma.$transaction(async (tx) => {
    await tx.template.updateMany({ where: { orgId, scene: t.scene, projectId: t.projectId, isDefault: true }, data: { isDefault: false } });
    await tx.template.update({ where: { id }, data: { isDefault: true } });
  });
  return { id };
}

/** 复制模板（bug 连带工作流；名称 +copy）。 */
export async function copyTemplate(orgId: string, projectId: string | null, id: string) {
  const t = await prisma.template.findFirst({ where: { id, orgId }, select: { id: true, name: true, scene: true, fields: true, isDefault: true } });
  if (!t) throw new DomainError(ErrCode.TEMPLATE_NOT_FOUND, '模板不存在');
  if (t.scene === 'bug') {
    const where = await effectiveWhere(orgId, projectId, 'bug');
    const count = await prisma.template.count({ where });
    if (count >= BUG_TEMPLATE_LIMIT) throw new DomainError(ErrCode.VALIDATION_FAILED, `缺陷模板上限 ${BUG_TEMPLATE_LIMIT} 个`);
  }
  const projectMode = await templateModeEnabled(projectId);
  const copy = await prisma.template.create({
    data: {
      orgId, projectId: projectMode && projectId ? projectId : null, scene: t.scene,
      name: `${t.name}_copy`, fields: toJson(t.fields), isDefault: false,
    },
    select: { id: true },
  });
  if (t.scene === 'bug') await copyWorkflow(t.id, copy.id);
  return copy;
}

/** 删除：默认模板与系统模板不可删；有引用不可删。 */
export async function deleteTemplate(orgId: string, projectId: string | null, id: string) {
  const t = await prisma.template.findFirst({ where: { id, orgId }, select: { id: true, isDefault: true, isSystem: true, scene: true } });
  if (!t) throw new DomainError(ErrCode.TEMPLATE_NOT_FOUND, '模板不存在');
  if (t.isDefault) throw new DomainError(ErrCode.VALIDATION_FAILED, '默认模板不可删除（先切换默认）');
  if (t.isSystem) throw new DomainError(ErrCode.FORBIDDEN, '系统模板不可删除');
  const ref = t.scene === 'bug'
    ? await prisma.bug.count({ where: { templateId: id } })
    : await prisma.functionalCase.count({ where: { templateId: id } });
  if (ref > 0) throw new DomainError(ErrCode.VALIDATION_FAILED, `模板仍被 ${ref} 条实例引用`);
  await prisma.$transaction(async (tx) => {
    const states = await tx.workflowState.findMany({ where: { templateId: id }, select: { id: true } });
    const stateIds = states.map((s) => s.id);
    if (stateIds.length) {
      await tx.workflowTransition.deleteMany({ where: { OR: [{ fromStateId: { in: stateIds } }, { toStateId: { in: stateIds } }] } });
      await tx.workflowState.deleteMany({ where: { templateId: id } });
    }
    await tx.template.delete({ where: { id } });
  });
}

/** 项目模板模式启用（不可逆）：拷贝组织默认模板（含工作流）为项目模板。 */
export async function enableProjectTemplateMode(orgId: string, projectId: string, actorId: string) {
  const already = await templateModeEnabled(projectId);
  if (already) throw new DomainError(ErrCode.VALIDATION_FAILED, '项目模板已启用（不可逆，无法重复操作）');
  await prisma.$transaction(async (tx) => {
    const orgTemplates = await tx.template.findMany({ where: { orgId, projectId: null }, select: { id: true, scene: true, name: true, fields: true, isDefault: true } });
    for (const t of orgTemplates) {
      const copy = await tx.template.create({
        data: { orgId, projectId, scene: t.scene, name: t.name, fields: toJson(t.fields), isDefault: t.isDefault },
        select: { id: true },
      });
      if (t.scene === 'bug') await copyWorkflowTx(tx, t.id, copy.id);
    }
    await tx.appSetting.upsert({
      where: { projectId_key: { projectId, key: 'template.mode' } },
      update: { value: { enabled: true } },
      create: { projectId, key: 'template.mode', value: { enabled: true } },
    });
  });
  await prisma.auditLog.create({
    data: { userId: actorId, scope: 'project', projectId, action: 'template.mode.enable', objectType: 'project', objectId: projectId },
  }).catch(() => undefined);
  return { enabled: true };
}

export async function getTemplateMode(projectId: string) {
  return { enabled: await templateModeEnabled(projectId) };
}

/** 当前生效模板（scene 级默认）。 */
export async function effectiveTemplate(orgId: string, projectId: string, scene: 'case' | 'bug') {
  const where = await effectiveWhere(orgId, projectId, scene);
  const t = await prisma.template.findFirst({
    where: { ...where, isDefault: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, fields: true },
  });
  if (!t) return null;
  return { id: t.id, name: t.name, fields: t.fields as { fieldKey: string; required?: boolean; visibleInList?: boolean }[] };
}

export async function fieldDefsForTemplate(orgId: string, scene: 'case' | 'bug') {
  const defs = await prisma.fieldDef.findMany({ where: { orgId, scene }, orderBy: { createdAt: 'asc' } });
  return defs.map((d) => {
    const opts = d.options as Record<string, unknown>;
    return {
      scene: d.scene, name: d.name, key: d.key, type: d.type,
      required: d.required,
      defaultValue: (opts.defaultValue as string | number | string[] | boolean | null) ?? undefined,
      options: opts,
      enabled: opts.enabled !== false,
    };
  }).filter((d) => d.enabled);
}

// ── 工作流（bug scene；挂靠生效的默认缺陷模板）──

async function resolveWorkflowTemplate(orgId: string, projectId: string, templateId?: string) {
  if (templateId) {
    const t = await prisma.template.findFirst({ where: { id: templateId, orgId }, select: { id: true } });
    if (!t) throw new DomainError(ErrCode.TEMPLATE_NOT_FOUND, '模板不存在');
    return t.id;
  }
  const effective = await effectiveTemplate(orgId, projectId, 'bug');
  if (!effective) throw new DomainError(ErrCode.TEMPLATE_NOT_FOUND, '默认缺陷模板缺失，请重新初始化');
  return effective.id;
}

export async function getWorkflow(orgId: string, projectId: string, templateId?: string) {
  const tid = await resolveWorkflowTemplate(orgId, projectId, templateId);
  const states = await prisma.workflowState.findMany({ where: { templateId: tid }, orderBy: { id: 'asc' } });
  const transitions = await prisma.workflowTransition.findMany({
    where: { OR: [{ fromStateId: { in: states.map((s) => s.id) } }, { toStateId: { in: states.map((s) => s.id) } }] },
  });
  const idToSerial = new Map(states.map((s) => [s.id, s.serial]));
  return {
    templateId: tid,
    states: states.map((s) => ({ id: s.id, serial: s.serial, isStart: s.isStart, isEnd: s.isEnd })),
    transitions: transitions
      .map((t) => ({ from: idToSerial.get(t.fromStateId), to: idToSerial.get(t.toStateId) }))
      .filter((t): t is { from: string; to: string } => Boolean(t.from && t.to)),
  };
}

export async function createWorkflowState(orgId: string, projectId: string, input: { serial: string; isStart?: boolean; isEnd?: boolean }) {
  const tid = await resolveWorkflowTemplate(orgId, projectId);
  const dup = await prisma.workflowState.findFirst({ where: { templateId: tid, serial: input.serial }, select: { id: true } });
  if (dup) throw new DomainError(ErrCode.VALIDATION_FAILED, `状态「${input.serial}」已存在`);
  return prisma.$transaction(async (tx) => {
    if (input.isStart) {
      await tx.workflowState.updateMany({ where: { templateId: tid, isStart: true }, data: { isStart: false } });
    }
    const startCount = await tx.workflowState.count({ where: { templateId: tid, isStart: true } });
    return tx.workflowState.create({
      data: { templateId: tid, scene: 'bug', serial: input.serial, isStart: input.isStart ?? startCount === 0, isEnd: input.isEnd ?? false },
      select: { id: true, serial: true, isStart: true, isEnd: true },
    });
  });
}

export async function updateWorkflowState(orgId: string, projectId: string, stateId: string, input: { serial?: string; isStart?: boolean; isEnd?: boolean }) {
  const state = await prisma.workflowState.findFirst({ where: { id: stateId }, select: { id: true, templateId: true, serial: true, isStart: true } });
  if (!state) throw new DomainError(ErrCode.VALIDATION_FAILED, '状态不存在');
  const tid = await resolveWorkflowTemplate(orgId, projectId);
  if (state.templateId !== tid) throw new DomainError(ErrCode.VALIDATION_FAILED, '状态不属于当前生效模板');
  return prisma.$transaction(async (tx) => {
    if (input.isStart) {
      await tx.workflowState.updateMany({ where: { templateId: tid, isStart: true }, data: { isStart: false } });
    }
    return tx.workflowState.update({
      where: { id: stateId },
      data: {
        ...(input.serial !== undefined ? { serial: input.serial } : {}),
        ...(input.isStart !== undefined ? { isStart: input.isStart } : {}),
        ...(input.isEnd !== undefined ? { isEnd: input.isEnd } : {}),
      },
      select: { id: true, serial: true, isStart: true, isEnd: true },
    });
  });
}

/** 初始态不可删；被流转引用先清理引用。 */
export async function deleteWorkflowState(orgId: string, projectId: string, stateId: string) {
  const state = await prisma.workflowState.findFirst({ where: { id: stateId }, select: { id: true, isStart: true, templateId: true, serial: true } });
  if (!state) throw new DomainError(ErrCode.VALIDATION_FAILED, '状态不存在');
  if (state.isStart) throw new DomainError(ErrCode.VALIDATION_FAILED, '初始状态不可删除');
  const inUse = await prisma.bug.count({ where: { status: state.serial } });
  if (inUse > 0) throw new DomainError(ErrCode.VALIDATION_FAILED, `仍有 ${inUse} 条缺陷处于该状态`);
  await prisma.$transaction(async (tx) => {
    await tx.workflowTransition.deleteMany({ where: { OR: [{ fromStateId: stateId }, { toStateId: stateId }] } });
    await tx.workflowState.delete({ where: { id: stateId } });
  });
  return { ok: true };
}

/** 流转矩阵全量替换（from/to serial 白名单）。 */
export async function updateWorkflowTransitions(orgId: string, projectId: string, transitions: { fromSerial: string; toSerial: string }[]) {
  const tid = await resolveWorkflowTemplate(orgId, projectId);
  const states = await prisma.workflowState.findMany({ where: { templateId: tid }, select: { id: true, serial: true } });
  const bySerial = new Map(states.map((s) => [s.serial, s.id]));
  for (const t of transitions) {
    if (!bySerial.has(t.fromSerial) || !bySerial.has(t.toSerial)) {
      throw new DomainError(ErrCode.VALIDATION_FAILED, `流转含未知状态：${t.fromSerial} → ${t.toSerial}`);
    }
    if (t.fromSerial === t.toSerial) throw new DomainError(ErrCode.VALIDATION_FAILED, '不允许自流转');
  }
  await prisma.$transaction(async (tx) => {
    await tx.workflowTransition.deleteMany({ where: { OR: [{ fromStateId: { in: states.map((s) => s.id) } }, { toStateId: { in: states.map((s) => s.id) } }] } });
    for (const t of transitions) {
      await tx.workflowTransition.create({
        data: { fromStateId: bySerial.get(t.fromSerial)!, toStateId: bySerial.get(t.toSerial)! },
      });
    }
  });
  return { count: transitions.length };
}

// ── 内部：工作流拷贝/预置 ──

async function copyWorkflowTx(tx: Pick<Prisma.TransactionClient, 'workflowState' | 'workflowTransition'>, fromTemplateId: string, toTemplateId: string) {
  const states = await tx.workflowState.findMany({ where: { templateId: fromTemplateId } });
  const idMap = new Map<string, string>();
  for (const s of states) {
    const created = await tx.workflowState.create({
      data: { templateId: toTemplateId, scene: 'bug', serial: s.serial, isStart: s.isStart, isEnd: s.isEnd },
    });
    idMap.set(s.id, created.id);
  }
  const transitions = await tx.workflowTransition.findMany({
    where: { OR: [{ fromStateId: { in: states.map((s) => s.id) } }, { toStateId: { in: states.map((s) => s.id) } }] },
  });
  for (const t of transitions) {
    const from = idMap.get(t.fromStateId);
    const to = idMap.get(t.toStateId);
    if (from && to) await tx.workflowTransition.create({ data: { fromStateId: from, toStateId: to } });
  }
}

async function copyWorkflow(fromTemplateId: string, toTemplateId: string) {
  await copyWorkflowTx(prisma, fromTemplateId, toTemplateId);
}

async function seedDefaultWorkflow(templateId: string) {
  const pending = await prisma.workflowState.create({ data: { templateId, scene: 'bug', serial: '待处理', isStart: true } });
  const processing = await prisma.workflowState.create({ data: { templateId, scene: 'bug', serial: '处理中' } });
  const closed = await prisma.workflowState.create({ data: { templateId, scene: 'bug', serial: '已关闭', isEnd: true } });
  for (const [from, to] of [[pending, processing], [processing, closed]] as const) {
    await prisma.workflowTransition.create({ data: { fromStateId: from.id, toStateId: to.id } });
  }
}
