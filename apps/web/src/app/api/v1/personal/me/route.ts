import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { withAuth } from "@/server/guard";

export const runtime = "nodejs";

export const GET = withAuth(async (ctx) => {
  const user = await prisma.user.findFirst({
    where: { id: ctx.userId },
    select: { id: true, email: true, name: true },
  });
  return NextResponse.json(
    ok(user ? { userId: user.id, email: user.email, name: user.name } : null),
  );
});
