import { NextResponse } from "next/server";
import { ok, fail, ErrCode, ErrMsg, execTaskListQuerySchema } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { toResponse } from "@/server/guard";
import { getActiveUserId } from "@/server/current-user";
import { permissionSetFor } from "@/server/rbac";
import { ensureBoot } from "@/server/boot";
import { listExecTasks } from "@/server/domains/exec/exec.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

/** SYS-006 跨项目任务列表：登录 + 任一可见项目具备 PROJECT_EXEC_TASK:READ。
 *  可见集合 = 用户为成员的项目（简化口径，org 管理员经项目成员关系可见）。 */
export const GET = async (req: Request): Promise<NextResponse> => {
  try {
    ensureBoot();
    const userId = await getActiveUserId();
    if (!userId) {
      return NextResponse.json(fail(ErrCode.UNAUTHENTICATED, ErrMsg[ErrCode.UNAUTHENTICATED]!), {
        status: 401,
      });
    }
    const memberships = await prisma.projectMember.findMany({
      where: { userId },
      select: { projectId: true },
    });
    const visible = memberships.map((m) => m.projectId);
    if (visible.length === 0) {
      return NextResponse.json(fail(ErrCode.FORBIDDEN, "缺少权限点 PROJECT_EXEC_TASK:READ"), {
        status: 403,
      });
    }
    const projects = await prisma.project.findMany({
      where: { id: { in: visible }, deletedAt: null },
      select: { id: true, orgId: true },
    });
    let allowed = false;
    for (const p of projects) {
      const perms = await permissionSetFor(userId, { orgId: p.orgId, projectId: p.id });
      if (perms.has("PROJECT_EXEC_TASK:READ")) {
        allowed = true;
        break;
      }
    }
    if (!allowed) {
      return NextResponse.json(fail(ErrCode.FORBIDDEN, "缺少权限点 PROJECT_EXEC_TASK:READ"), {
        status: 403,
      });
    }
    const parsed = execTaskListQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await listExecTasks(undefined, visible, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
};
