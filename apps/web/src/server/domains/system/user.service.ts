/** SYS-004：系统用户管理（创建/编辑/重置密码/启停/软删/列表）。 */
import { randomBytes } from "node:crypto";
import { DomainError, ErrCode, config } from "@rabbit/shared";

/** 上限运行时可配（e2e 经 RABBIT_USER_LIMIT 放宽；产品默认 30） */
const USER_LIMIT = config.userLimit;
import type { UserCreateInput } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { hashPassword } from "./auth.service";

function genPassword(): string {
  return `Rb-${randomBytes(6).toString("base64url")}`;
}

export async function listUsers(q: { keyword?: string; page: number; pageSize: number }) {
  const where = {
    deletedAt: null,
    ...(q.keyword
      ? {
          OR: [
            { email: { contains: q.keyword, mode: "insensitive" as const } },
            { name: { contains: q.keyword, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: { id: true, email: true, name: true, phone: true, status: true, createdAt: true },
    }),
  ]);
  return {
    total,
    limit: USER_LIMIT,
    items: items.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
  };
}

export async function createUser(actorId: string, input: UserCreateInput) {
  const active = await prisma.user.count({ where: { deletedAt: null } });
  if (active >= USER_LIMIT)
    throw new DomainError(ErrCode.USER_TOO_MANY, `社区版用户上限 ${USER_LIMIT}`);
  // 邮箱唯一校验含软删用户（删除用户不清理占用，与基线口径一致）
  const exist = await prisma.user.findFirst({
    where: { email: input.email },
    select: { id: true },
  });
  if (exist) throw new DomainError(ErrCode.EMAIL_EXISTS, "该邮箱已被占用（含已删除用户）");
  const password = input.password ?? genPassword();
  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      phone: input.phone,
      passwordHash: await hashPassword(password),
    },
    select: { id: true, email: true, name: true },
  });
  await prisma.auditLog
    .create({
      data: {
        userId: actorId,
        scope: "system",
        action: "user.create",
        objectType: "user",
        objectId: user.id,
      },
    })
    .catch(() => undefined);
  // 初始密码仅创建响应一次性返回
  return { ...user, initialPassword: password };
}

export async function updateUser(
  actorId: string,
  userId: string,
  input: { name?: string; phone?: string | null },
) {
  const existing = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw new DomainError(ErrCode.USER_NOT_FOUND, "用户不存在");
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
    },
    select: { id: true, email: true, name: true, phone: true, status: true },
  });
  await prisma.auditLog
    .create({
      data: {
        userId: actorId,
        scope: "system",
        action: "user.update",
        objectType: "user",
        objectId: userId,
      },
    })
    .catch(() => undefined);
  return updated;
}

export async function resetPassword(actorId: string, userId: string) {
  const existing = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw new DomainError(ErrCode.USER_NOT_FOUND, "用户不存在");
  const password = genPassword();
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password) },
  });
  await prisma.auditLog
    .create({
      data: {
        userId: actorId,
        scope: "system",
        action: "user.reset_password",
        objectType: "user",
        objectId: userId,
      },
    })
    .catch(() => undefined);
  return { newPassword: password }; // 一次性返回
}

/** 禁用用户：立即失效其全部会话（守卫按请求校验用户状态，SYS-004 §2）。 */
export async function setUserStatus(
  actorId: string,
  userId: string,
  status: "ACTIVE" | "DISABLED",
) {
  const existing = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, email: true },
  });
  if (!existing) throw new DomainError(ErrCode.USER_NOT_FOUND, "用户不存在");
  if (existing.email === "admin@rabbit.test")
    throw new DomainError(ErrCode.VALIDATION_FAILED, "内置管理员不可禁用");
  await prisma.user.update({ where: { id: userId }, data: { status } });
  await prisma.auditLog
    .create({
      data: {
        userId: actorId,
        scope: "system",
        action: `user.${status.toLowerCase()}`,
        objectType: "user",
        objectId: userId,
      },
    })
    .catch(() => undefined);
  return { id: userId, status };
}

/** 软删：登录失效、成员关系保留痕迹、业务数据不清理（SYS-004 §2）。 */
export async function deleteUser(actorId: string, userId: string) {
  const existing = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, email: true },
  });
  if (!existing) throw new DomainError(ErrCode.USER_NOT_FOUND, "用户不存在");
  if (existing.email === "admin@rabbit.test")
    throw new DomainError(ErrCode.VALIDATION_FAILED, "内置管理员不可删除");
  await prisma.user.update({
    where: { id: userId },
    data: { deletedAt: new Date(), status: "DISABLED" },
  });
  await prisma.auditLog
    .create({
      data: {
        userId: actorId,
        scope: "system",
        action: "user.delete",
        objectType: "user",
        objectId: userId,
      },
    })
    .catch(() => undefined);
}
