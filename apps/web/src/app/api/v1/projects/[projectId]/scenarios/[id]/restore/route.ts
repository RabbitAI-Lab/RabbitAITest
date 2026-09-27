import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { restoreScenario } from "@/server/domains/api/scenario.service";

export const runtime = "nodejs";

export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:UPDATE");
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return NextResponse.json(ok(await restoreScenario(ctx.projectId, ctx.userId, id)));
  } catch (err) {
    return toResponse(err);
  }
});
