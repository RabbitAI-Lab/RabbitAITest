import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { withAuth } from "@/server/guard";

export const runtime = "nodejs";

export const GET = withAuth(async (ctx) => {
  const rows = await prisma.projectMember.findMany({
    where: { userId: ctx.userId },
    select: {
      role: true,
      project: { select: { id: true, name: true, num: true, deletedAt: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const projects = rows
    .filter((r) => r.project.deletedAt === null && r.project.status === "ENABLED")
    .map((r) => ({ id: r.project.id, name: r.project.name, num: r.project.num, role: r.role }));
  return NextResponse.json(ok(projects));
});
