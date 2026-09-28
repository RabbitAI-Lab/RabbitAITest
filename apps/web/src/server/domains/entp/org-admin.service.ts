/**
 * ENTP-001 多组织管理：组织 CRUD（创建/编辑/结束恢复/级联删除）+ 成员移除 + 列表统计。
 * MULTI_ORG 特性门控由 Route Handler 调 assertEntpEnabled（写端点）。
 */
import { DomainError, ErrCode, type OrgCreateInput, type OrgUpdateInput } from "@rabbit/shared";
import { prisma, ensureOrgPresetGroups, ensureDefaultTemplates } from "@rabbit/db";

/** seed 默认组织（保护不可删）：取最早创建的组织为默认口径。 */
export async function getDefaultOrgId(): Promise<string> {
  const first = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!first) throw new DomainError(ErrCode.USER_NOT_FOUND, "系统未初始化");
  return first.id;
}

export async function listOrgs() {
  const defaultId = await getDefaultOrgId();
  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      createdAt: true,
      _count: { select: { members: true, projects: true } },
    },
  });
  return {
    total: orgs.length,
    items: orgs.map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description,
      status: o.status as "ACTIVE" | "ENDED",
      memberCount: o._count.members,
      projectCount: o._count.projects,
      isDefault: o.id === defaultId,
      createdAt: o.createdAt.toISOString(),
    })),
  };
}

export async function createOrg(actorId: string, input: OrgCreateInput) {
  const owner = await prisma.user.findFirst({
    where: { email: input.ownerEmail, status: "ACTIVE", deletedAt: null },
    select: { id: true },
  });
  if (!owner) throw new DomainError(ErrCode.USER_NOT_FOUND, "管理员邮箱对应的用户不存在");
  const dup = await prisma.organization.findFirst({
    where: { name: input.name },
    select: { id: true },
  });
  if (dup) throw new DomainError(ErrCode.ORG_NAME_EXISTS, "组织名称已存在");
  const org = await prisma.$transaction(async (tx) => {
    const created = await tx.organization.create({
      data: {
        name: input.name,
        description: input.description,
        ownerId: owner.id,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    await tx.orgMember.create({ data: { orgId: created.id, userId: owner.id } });
    // 组织级预设（用户组/默认模板），不建演示项目（企业组织从空开始；无项目级预设）
    await ensureOrgPresetGroups(tx, created.id);
    await ensureDefaultTemplates(tx, created.id);
    return created;
  });
  return { id: org.id };
}

export async function updateOrg(orgId: string, input: OrgUpdateInput) {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new DomainError(ErrCode.USER_NOT_FOUND, "组织不存在");
  if (input.name && input.name !== org.name) {
    const dup = await prisma.organization.findFirst({
      where: { name: input.name },
      select: { id: true },
    });
    if (dup) throw new DomainError(ErrCode.ORG_NAME_EXISTS, "组织名称已存在");
  }
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
  });
  return { id: orgId };
}

/** 删除组织：needConfirm 二次确认；默认组织保护；有任务历史的池不在此列——组织级联=逐项目走既有项目删除链路。 */
export async function deleteOrg(orgId: string, needConfirm: boolean) {
  if (!needConfirm)
    throw new DomainError(
      ErrCode.ORG_DELETE_CONFIRM_REQUIRED,
      "删除组织需二次确认（needConfirm=true）",
    );
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: { projects: true },
  });
  if (!org) throw new DomainError(ErrCode.USER_NOT_FOUND, "组织不存在");
  const defaultId = await getDefaultOrgId();
  if (orgId === defaultId)
    throw new DomainError(ErrCode.ORG_DEFAULT_PROTECTED, "默认组织受保护，不可删除");
  await prisma.$transaction(async (tx) => {
    // 项目域数据级联：projects 级联其子表（DB onDelete Cascade 覆盖用例/接口/场景/执行/报告等）
    const projectIds = org.projects.map((p) => p.id);
    if (projectIds.length > 0) {
      await tx.execTask.updateMany({
        where: { projectId: { in: projectIds } },
        data: { poolId: null },
      });
      await tx.project.deleteMany({ where: { id: { in: projectIds } } });
    }
    await tx.orgMember.deleteMany({ where: { orgId } });
    await tx.department.deleteMany({ where: { orgId } });
    await tx.group.deleteMany({ where: { orgId } });
    await tx.organization.delete({ where: { id: orgId } });
  });
  return { id: orgId, deletedProjects: org.projects.length };
}

/** 本人组织列表（切换器数据源；仅 ACTIVE）。 */
export async function listMyOrgs(userId: string) {
  const rows = await prisma.orgMember.findMany({
    where: { userId, org: { status: "ACTIVE" } },
    select: { org: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.org);
}
