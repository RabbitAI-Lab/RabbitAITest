/**
 * 预置数据初始化（SYS-003/004、PROJ-002）：
 * 三级预置用户组、每场景默认模板（含缺陷默认工作流）、bug 场景默认模块。
 * 注册流程与 seed 回填共用；全部幂等（where 唯一键 upsert / findFirst 跳过）。
 */
import { PRESET_GROUP_PERMISSIONS } from "@rabbit/shared";
import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

export async function ensureSystemPresetGroups(tx: Tx): Promise<void> {
  for (const [name, perms] of [
    ["系统管理员", PRESET_GROUP_PERMISSIONS.SYSTEM_ADMIN],
    ["系统成员", PRESET_GROUP_PERMISSIONS.SYSTEM_MEMBER],
  ] as const) {
    const existing = await tx.group.findFirst({
      where: { scope: "system", name },
      select: { id: true },
    });
    if (!existing) {
      await tx.group.create({
        data: { scope: "system", name, isSystem: true, permissions: [...perms] },
      });
    }
  }
}

export async function ensureOrgPresetGroups(tx: Tx, orgId: string): Promise<void> {
  for (const [name, perms] of [
    ["组织管理员", PRESET_GROUP_PERMISSIONS.ORG_ADMIN],
    ["组织成员", PRESET_GROUP_PERMISSIONS.ORG_MEMBER],
  ] as const) {
    const existing = await tx.group.findFirst({
      where: { scope: "org", orgId, name },
      select: { id: true },
    });
    if (!existing) {
      await tx.group.create({
        data: { scope: "org", orgId, name, isSystem: true, permissions: [...perms] },
      });
    }
  }
}

export async function ensureProjectPresetGroups(tx: Tx, projectId: string): Promise<void> {
  for (const [name, perms] of [
    ["项目管理员", PRESET_GROUP_PERMISSIONS.PROJECT_ADMIN],
    ["项目成员", PRESET_GROUP_PERMISSIONS.PROJECT_MEMBER],
  ] as const) {
    const existing = await tx.group.findFirst({
      where: { scope: "project", projectId, name },
      select: { id: true },
    });
    if (!existing) {
      await tx.group.create({
        data: { scope: "project", projectId, name, isSystem: true, permissions: [...perms] },
      });
    }
  }
}

/** 每场景默认模板（org 级；缺陷默认工作流：待处理→处理中→已关闭）。返回 { caseTemplateId, bugTemplateId } */
export async function ensureDefaultTemplates(
  tx: Tx,
  orgId: string,
): Promise<{ caseTemplateId: string; bugTemplateId: string }> {
  let caseT = await tx.template.findFirst({
    where: { orgId, scene: "case", isDefault: true },
    select: { id: true },
  });
  if (!caseT) {
    caseT = await tx.template.create({
      data: {
        orgId,
        scene: "case",
        name: "功能用例默认模板",
        isDefault: true,
        isSystem: true,
        fields: [],
      },
      select: { id: true },
    });
  }
  let bugT = await tx.template.findFirst({
    where: { orgId, scene: "bug", isDefault: true },
    select: { id: true },
  });
  if (!bugT) {
    bugT = await tx.template.create({
      data: {
        orgId,
        scene: "bug",
        name: "缺陷默认模板",
        isDefault: true,
        isSystem: true,
        fields: [],
      },
      select: { id: true },
    });
    const pending = await tx.workflowState.create({
      data: { templateId: bugT.id, scene: "bug", serial: "待处理", isStart: true },
    });
    const processing = await tx.workflowState.create({
      data: { templateId: bugT.id, scene: "bug", serial: "处理中" },
    });
    const closed = await tx.workflowState.create({
      data: { templateId: bugT.id, scene: "bug", serial: "已关闭", isEnd: true },
    });
    for (const [from, to] of [
      [pending, processing],
      [processing, closed],
      [closed, pending],
    ] as const) {
      await tx.workflowTransition.create({ data: { fromStateId: from.id, toStateId: to.id } });
    }
  }
  return { caseTemplateId: caseT.id, bugTemplateId: bugT.id };
}

export async function ensureBugModule(tx: Tx, projectId: string): Promise<string> {
  let m = await tx.moduleNode.findFirst({
    where: { projectId, scene: "bug", isDefault: true },
    select: { id: true },
  });
  if (!m) {
    m = await tx.moduleNode.create({
      data: { projectId, scene: "bug", name: "未规划缺陷", isDefault: true },
      select: { id: true },
    });
  }
  return m.id;
}

/** 注册/建项目时的完整预置初始化（org 组 + project 组 + 模板 + bug 模块 + 创建者入管理员组）。 */
export async function initOrgAndProjectPresets(
  tx: Tx,
  orgId: string,
  projectId: string,
  creatorUserId: string,
): Promise<void> {
  await ensureOrgPresetGroups(tx, orgId);
  await ensureProjectPresetGroups(tx, projectId);
  await ensureDefaultTemplates(tx, orgId);
  await ensureBugModule(tx, projectId);
  const orgAdmin = await tx.group.findFirst({
    where: { scope: "org", orgId, name: "组织管理员" },
    select: { id: true },
  });
  if (orgAdmin) await addGroupMember(tx, orgAdmin.id, creatorUserId);
  const projAdmin = await tx.group.findFirst({
    where: { scope: "project", projectId, name: "项目管理员" },
    select: { id: true },
  });
  if (projAdmin) await addGroupMember(tx, projAdmin.id, creatorUserId);
}

export async function addGroupMember(tx: Tx, groupId: string, userId: string): Promise<void> {
  await tx.groupMember.upsert({
    where: { groupId_userId: { groupId, userId } },
    update: {},
    create: { groupId, userId },
  });
}
