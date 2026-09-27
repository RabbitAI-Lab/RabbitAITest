import { okResponse, toResponse, withAuth, zodParse } from "@/server/guard";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { personalMeUpdateSchema, changePasswordSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/system/personal.service";
import { prisma } from "@rabbit/db";

export const runtime = "nodejs";

/** SYS-001 既有 me 端点（登录态检查用，响应形态保持不变）。 */
export const GET = withAuth(async (ctx) => {
  const user = await prisma.user.findFirst({
    where: { id: ctx.userId },
    select: { id: true, email: true, name: true },
  });
  return okResponse(user ? { userId: user.id, email: user.email, name: user.name } : null);
});

/** SYS-007：个人信息编辑（姓名/手机；邮箱=登录名不可改）。 */
export const PATCH = withAuth(async (ctx, req: Request) => {
  try {
    const body = zodParse(personalMeUpdateSchema, await req.json());
    const updated = await svc.updateMe(ctx.userId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: "personal.me_update",
      objectType: "user",
      objectId: ctx.userId,
      detail: { name: updated.name },
    });
    void flushAudit();
    return okResponse(updated);
  } catch (err) {
    return toResponse(err);
  }
});

/** SYS-007：修改密码（旧密码错 422 10020；无状态 Cookie 口径见服务注释/规格勘误）。 */
export const POST = withAuth(async (ctx, req: Request) => {
  try {
    const body = zodParse(changePasswordSchema, await req.json());
    const r = await svc.changePassword(ctx.userId, body.oldPassword, body.newPassword);
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: "personal.change_password",
      objectType: "user",
      objectId: ctx.userId,
    });
    void flushAudit();
    return okResponse(r);
  } catch (err) {
    return toResponse(err);
  }
});
