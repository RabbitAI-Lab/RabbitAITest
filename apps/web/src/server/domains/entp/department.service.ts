/**
 * ENTP-008 部门管理：组织级部门树 CRUD + 成员挂载（多对多）。
 * USER_SCALE 特性门控由 Route Handler 调 assertEntpEnabled。
 */
import { DomainError, ErrCode, type DepartmentTreeItem } from "@rabbit/shared";
import { prisma } from "@rabbit/db";

async function assertOrgExists(orgId: string) {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) throw new DomainError(ErrCode.PROJECT_NOT_FOUND, "组织不存在或无权访问");
}

/** 同层重名校验（orgId+parentId+name 应用层唯一）。 */
async function assertNameFree(
  orgId: string,
  parentId: string | null,
  name: string,
  excludeId?: string,
) {
  const dup = await prisma.department.findFirst({
    where: { orgId, parentId, name, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (dup) throw new DomainError(ErrCode.DEPARTMENT_NAME_EXISTS, "同层级下已存在同名部门");
}

/** 环与跨组织检测：新 parentId 必须同组织且不在自身后代链上。 */
async function assertParentValid(orgId: string, departmentId: string, parentId: string | null) {
  if (!parentId) return;
  const parent = await prisma.department.findUnique({
    where: { id: parentId },
    select: { orgId: true, id: true },
  });
  if (!parent || parent.orgId !== orgId)
    throw new DomainError(ErrCode.DEPARTMENT_CYCLE, "部门上级不合法（跨组织）");
  // BFS 后代链检测：parentId 不得是 departmentId 自身或其后代
  const queue = [departmentId];
  const seen = new Set<string>();
  while (queue.length) {
    const cur = queue.shift() as string;
    if (cur === parentId)
      throw new DomainError(ErrCode.DEPARTMENT_CYCLE, "部门上级不合法（形成环）");
    if (seen.has(cur)) continue;
    seen.add(cur);
    const children = await prisma.department.findMany({
      where: { parentId: cur },
      select: { id: true },
    });
    queue.push(...children.map((c) => c.id));
  }
}

export async function listTree(orgId: string): Promise<DepartmentTreeItem[]> {
  await assertOrgExists(orgId);
  const [departments, counts] = await Promise.all([
    prisma.department.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } }),
    prisma.departmentMember.groupBy({
      by: ["departmentId"],
      where: { department: { orgId } },
      _count: { _all: true },
    }),
  ]);
  const countMap = new Map(counts.map((c) => [c.departmentId, c._count._all]));
  const nodes = new Map<string, DepartmentTreeItem>(
    departments.map((d) => [
      d.id,
      {
        id: d.id,
        name: d.name,
        parentId: d.parentId,
        memberCount: countMap.get(d.id) ?? 0,
        children: [],
      },
    ]),
  );
  const roots: DepartmentTreeItem[] = [];
  for (const d of departments) {
    const node = nodes.get(d.id) as DepartmentTreeItem;
    if (d.parentId && nodes.has(d.parentId)) nodes.get(d.parentId)?.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function createDepartment(
  orgId: string,
  input: { name: string; parentId?: string | null },
) {
  await assertOrgExists(orgId);
  const parentId = input.parentId ?? null;
  if (parentId) {
    // 新建无后代链：仅校验 parent 属于本组织（误传 parentId 作 departmentId 会自环假报——S9 勘误 3）
    const parent = await prisma.department.findUnique({
      where: { id: parentId },
      select: { orgId: true },
    });
    if (!parent || parent.orgId !== orgId)
      throw new DomainError(ErrCode.DEPARTMENT_CYCLE, "部门上级不合法（跨组织）");
  }
  await assertNameFree(orgId, parentId, input.name);
  const created = await prisma.department.create({
    data: { orgId, name: input.name, parentId },
    select: { id: true },
  });
  return created;
}

export async function updateDepartment(
  orgId: string,
  departmentId: string,
  input: { name: string; parentId?: string | null },
) {
  const dept = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!dept || dept.orgId !== orgId)
    throw new DomainError(ErrCode.DEPARTMENT_NOT_FOUND, "部门不存在");
  const parentId = input.parentId !== undefined ? input.parentId : dept.parentId;
  if (parentId === departmentId)
    throw new DomainError(ErrCode.DEPARTMENT_CYCLE, "部门上级不能是自身");
  await assertParentValid(orgId, departmentId, parentId);
  await assertNameFree(orgId, parentId, input.name, departmentId);
  await prisma.department.update({
    where: { id: departmentId },
    data: { name: input.name, parentId },
  });
  return { id: departmentId };
}

export async function deleteDepartment(orgId: string, departmentId: string) {
  const dept = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!dept || dept.orgId !== orgId)
    throw new DomainError(ErrCode.DEPARTMENT_NOT_FOUND, "部门不存在");
  const childCount = await prisma.department.count({ where: { parentId: departmentId } });
  if (childCount > 0)
    throw new DomainError(ErrCode.DEPARTMENT_HAS_CHILDREN, "部门存在子部门，不可删除");
  // 成员挂载级联解除（department_members onDelete Cascade）+ 部门删除
  await prisma.department.delete({ where: { id: departmentId } });
  return { id: departmentId };
}

export async function listDepartmentMembers(orgId: string, departmentId: string) {
  const dept = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!dept || dept.orgId !== orgId)
    throw new DomainError(ErrCode.DEPARTMENT_NOT_FOUND, "部门不存在");
  const rows = await prisma.departmentMember.findMany({
    where: { departmentId },
    select: { userId: true, user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ userId: r.userId, name: r.user.name, email: r.user.email }));
}

export async function addDepartmentMembers(orgId: string, departmentId: string, userIds: string[]) {
  const dept = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!dept || dept.orgId !== orgId)
    throw new DomainError(ErrCode.DEPARTMENT_NOT_FOUND, "部门不存在");
  const memberOrg = await prisma.orgMember.findMany({
    where: { orgId, userId: { in: userIds } },
    select: { userId: true },
  });
  const inOrg = new Set(memberOrg.map((m) => m.userId));
  const outsider = userIds.filter((u) => !inOrg.has(u));
  if (outsider.length > 0)
    throw new DomainError(ErrCode.DEPARTMENT_MEMBER_NOT_IN_ORG, "所选用户不在本组织");
  // 幂等 upsert（unique(departmentId,userId) 冲突跳过）
  await prisma.$transaction(
    userIds.map((userId) =>
      prisma.departmentMember.upsert({
        where: { departmentId_userId: { departmentId, userId } },
        update: {},
        create: { departmentId, userId },
      }),
    ),
  );
  return { added: userIds.length };
}

export async function removeDepartmentMember(orgId: string, departmentId: string, userId: string) {
  const dept = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!dept || dept.orgId !== orgId)
    throw new DomainError(ErrCode.DEPARTMENT_NOT_FOUND, "部门不存在");
  await prisma.departmentMember.deleteMany({ where: { departmentId, userId } });
  return { ok: true };
}
