import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { withAuth, toResponse } from "@/server/guard";

export const runtime = "nodejs";

/** 本人项目列表（ENTP-001 扩展：?orgId= 按组织过滤；org 恒 ACTIVE）。 */
export const GET = withAuth(async (ctx, req: Request) => {
  try {
    const orgId = new URL(req.url).searchParams.get("orgId");
    const rows = await prisma.projectMember.findMany({
      where: {
        userId: ctx.userId,
        ...(orgId ? { project: { orgId, org: { status: "ACTIVE" } } } : {}),
      },
      select: {
        role: true,
        project: {
          select: { id: true, name: true, num: true, deletedAt: true, status: true, orgId: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    const projects = rows
      .filter((r) => r.project.deletedAt === null && r.project.status === "ENABLED")
      .map((r) => ({
        id: r.project.id,
        name: r.project.name,
        num: r.project.num,
        role: r.role,
        orgId: r.project.orgId,
      }));
    return NextResponse.json(ok(projects));
  } catch (err) {
    return toResponse(err);
  }
});
