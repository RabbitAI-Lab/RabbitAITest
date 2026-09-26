/** SYS-004：三级自定义用户组（system/org/project 同一套逻辑，scope 参数区分）。 */
import { DomainError, ErrCode } from '@rabbit/shared';
import type { GroupUpsertInput } from '@rabbit/shared';
import { prisma } from '@rabbit/db';

export type GroupScope = 'system' | 'org' | 'project';
export interface ScopeRef { scope: GroupScope; orgId?: string; projectId?: string }

function scopePerm(scope: GroupScope): { read: string; write: string } {
  return scope === 'system'
    ? { read: 'SYSTEM_GROUP:READ', write: 'SYSTEM_GROUP:UPDATE' }
    : scope === 'org'
      ? { read: 'ORG_GROUP:READ', write: 'ORG_GROUP:UPDATE' }
      : { read: 'PROJECT_GROUP:READ', write: 'PROJECT_GROUP:UPDATE' };
}

export async function listGroups(ref: ScopeRef, query?: { withMembers?: string }) {
  const where = ref.scope === 'system'
    ? { scope: 'system' }
    : ref.scope === 'org'
      ? { scope: 'org', orgId: ref.orgId }
      : { scope: 'project', projectId: ref.projectId };
  const groups = await prisma.group.findMany({
    where,
    orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
    include: { _count: { select: { members: true } } },
  });
  const ids = groups.map((g) => g.id);
  const members = query?.withMembers && ids.length
    ? await prisma.groupMember.findMany({
        where: { groupId: { in: ids } },
        include: { user: { select: { id: true, email: true, name: true } } },
      })
    : [];
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    scope: g.scope,
    isSystem: g.isSystem,
    permissions: g.permissions as string[],
    disabled: g.disabled as string[],
    memberCount: g._count.members,
    createdAt: g.createdAt.toISOString(),
    members: members
      .filter((m) => m.groupId === g.id)
      .map((m) => ({ userId: m.userId, email: m.user.email, name: m.user.name })),
  }));
}

export async function createGroup(actorId: string, ref: ScopeRef, input: GroupUpsertInput) {
  if (ref.scope === 'org' && !ref.orgId) throw new DomainError(ErrCode.VALIDATION_FAILED, '缺少组织上下文');
  if (ref.scope === 'project' && !ref.projectId) throw new DomainError(ErrCode.VALIDATION_FAILED, '缺少项目上下文');
  return prisma.group.create({
    data: {
      name: input.name,
      description: input.description,
      scope: ref.scope,
      orgId: ref.scope === 'org' ? ref.orgId : null,
      projectId: ref.scope === 'project' ? ref.projectId : null,
      permissions: input.permissions,
      disabled: input.disabled,
    },
    select: { id: true, name: true },
  });
}

async function loadGroup(id: string) {
  const g = await prisma.group.findFirst({ where: { id }, select: { id: true, name: true, isSystem: true, scope: true, orgId: true, projectId: true } });
  if (!g) throw new DomainError(ErrCode.GROUP_NOT_FOUND, '用户组不存在');
  return g;
}

export async function updateGroup(actorId: string, id: string, input: GroupUpsertInput) {
  const g = await loadGroup(id);
  if (g.isSystem) throw new DomainError(ErrCode.FORBIDDEN, '预置组只读，不可修改');
  return prisma.group.update({
    where: { id },
    data: { name: input.name, description: input.description, permissions: input.permissions, disabled: input.disabled },
    select: { id: true, name: true },
  });
}

export async function deleteGroup(id: string) {
  const g = await loadGroup(id);
  if (g.isSystem) throw new DomainError(ErrCode.FORBIDDEN, '预置组不可删除');
  const count = await prisma.groupMember.count({ where: { groupId: id } });
  if (count > 0) throw new DomainError(ErrCode.VALIDATION_FAILED, `组内仍有 ${count} 名成员，请先移出`);
  await prisma.group.delete({ where: { id } });
}

/** 恢复默认：清空自定义权限勾选与禁用清单（预置组本身无此操作）。 */
export async function restoreGroupDefault(id: string) {
  const g = await loadGroup(id);
  if (g.isSystem) throw new DomainError(ErrCode.FORBIDDEN, '预置组无恢复默认操作');
  await prisma.group.update({ where: { id }, data: { permissions: [], disabled: [] } });
  return { id };
}

export async function addMembers(id: string, userIds: string[]) {
  const g = await loadGroup(id);
  if (!g) throw new DomainError(ErrCode.GROUP_NOT_FOUND, '用户组不存在');
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, deletedAt: null }, select: { id: true } });
  if (users.length !== userIds.length) throw new DomainError(ErrCode.VALIDATION_FAILED, '含不存在或已删除的用户');
  for (const u of users) {
    await prisma.groupMember.upsert({
      where: { groupId_userId: { groupId: id, userId: u.id } },
      update: {},
      create: { groupId: id, userId: u.id },
    });
  }
  return { added: users.length };
}

export async function removeMember(id: string, userId: string) {
  const r = await prisma.groupMember.deleteMany({ where: { groupId: id, userId } });
  if (r.count === 0) throw new DomainError(ErrCode.VALIDATION_FAILED, '该用户不在组内');
  return { removed: r.count };
}

export { scopePerm };
