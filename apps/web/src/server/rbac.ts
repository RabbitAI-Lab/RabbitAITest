import { prisma } from '@rabbit/db';
import { resolvePermissionSet, type PermissionPoint } from '@rabbit/shared';

/**
 * RBAC 检查链数据源（rbac-permission-model §4）：
 * 用户生效组 = 系统组（全局）+ 指定组织的 org 组 + 指定项目的 project 组；
 * 权限 = ∪(组权限点) −（任一组的 disabled 资源）。
 */
export async function effectiveGroups(
  userId: string,
  scope?: { orgId?: string; projectId?: string },
) {
  const gms = await prisma.groupMember.findMany({
    where: { userId },
    include: { group: { select: { id: true, scope: true, orgId: true, projectId: true, permissions: true, disabled: true, isSystem: true, name: true } } },
  });
  return gms
    .map((gm) => gm.group)
    .filter((g) => {
      if (g.scope === 'system') return true;
      if (g.scope === 'org') return scope?.orgId ? g.orgId === scope.orgId : true;
      if (g.scope === 'project') return scope?.projectId ? g.projectId === scope.projectId : true;
      return false;
    });
}

export async function permissionSetFor(
  userId: string,
  scope?: { orgId?: string; projectId?: string },
): Promise<Set<string>> {
  return resolvePermissionSet(await effectiveGroups(userId, scope));
}

/** 便捷断言（服务层/route 内使用）：无权限点 → 403 code 10003 */
export async function requirePermission(
  userId: string,
  point: PermissionPoint | string,
  scope?: { orgId?: string; projectId?: string },
): Promise<void> {
  const perms = await permissionSetFor(userId, scope);
  if (!perms.has(point)) {
    const { DomainError, ErrCode } = await import('@rabbit/shared');
    throw new DomainError(ErrCode.FORBIDDEN, `缺少权限点 ${point}`);
  }
}

export function hasPoint(set: Set<string>, point: PermissionPoint | string): boolean {
  return set.has(point);
}
