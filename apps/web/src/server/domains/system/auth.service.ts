import { hash, verify } from '@node-rs/argon2';
import { DomainError, ErrCode } from '@rabbit/shared';
import { prisma, initOrgAndProjectPresets } from '@rabbit/db';

const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTS);
}

export async function registerUser(email: string, password: string, userId?: string) {
  const exist = await prisma.user.findFirst({ where: { email }, select: { id: true } });
  if (exist) throw new DomainError(ErrCode.EMAIL_EXISTS, '该邮箱已注册');
  const emailName = email.split('@')[0] ?? '用户';
  // SYS-003：注册事务 = 用户 + 默认组织 + 演示项目 + OWNER 成员 + 两 scene 默认模块树
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { id: userId, email, name: emailName, passwordHash: await hashPassword(password) },
      select: { id: true, email: true },
    });
    const org = await tx.organization.create({
      data: { name: `${emailName}的组织`, ownerId: user.id },
      select: { id: true },
    });
    await tx.orgMember.create({ data: { orgId: org.id, userId: user.id } });
    const maxNum = await tx.$queryRawUnsafe<{ n: bigint | number }[]>(
      'SELECT COALESCE(MAX(num), 0) + 1 AS n FROM projects WHERE org_id = $1',
      org.id,
    );
    const row = maxNum[0];
    const project = await tx.project.create({
      data: { orgId: org.id, name: '演示项目', num: Number(row?.n ?? 1) },
      select: { id: true },
    });
    await tx.projectMember.create({
      data: { projectId: project.id, userId: user.id, role: 'OWNER' },
    });
    for (const [scene, name] of [['case', '未规划用例'], ['api', '未规划接口']] as const) {
      await tx.moduleNode.create({
        data: { projectId: project.id, scene, name, isDefault: true },
      });
    }
    // Sprint 1：三级预置组 + 默认模板（含缺陷工作流）+ bug 模块 + 创建者入管理员组（SYS-003/004、PROJ-002）
    await initOrgAndProjectPresets(tx, org.id, project.id, user.id);
    return { user, projectId: project.id };
  });
}

export async function loginUser(email: string, password: string) {
  const user = await prisma.user.findFirst({
    where: { email, status: 'ACTIVE', deletedAt: null },
    select: { id: true, email: true, passwordHash: true },
  });
  const okUser = user && (await verify(user.passwordHash, password)) ? user : null;
  if (!okUser) throw new DomainError(ErrCode.BAD_CREDENTIALS, '邮箱或密码错误');
  return { userId: okUser.id, email: okUser.email };
}

export async function audit(userId: string | null, action: string, objectType: string, objectId?: string) {
  await prisma.auditLog.create({
    data: { userId, scope: 'system', action, objectType, objectId },
  }).catch(() => undefined); // 审计失败不阻塞主流程，但绝不静默无痕（observability 由日志兜底）
}
