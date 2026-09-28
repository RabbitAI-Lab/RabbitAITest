import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { toggleSchedule } from "@/server/domains/api/schedule.service";

export const runtime = "nodejs";

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:UPDATE");
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
    return NextResponse.json(ok(await toggleSchedule(ctx.projectId, id, body.enabled !== false, ctx.userId)));
  } catch (err) {
    return toResponse(err);
  }
});
