import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { copyScenario } from "@/server/domains/api/scenario.service";

export const runtime = "nodejs";

export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:CREATE");
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return NextResponse.json(ok(await copyScenario(ctx.projectId, ctx.userId, id)), { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
});
