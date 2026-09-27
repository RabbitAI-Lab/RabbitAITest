import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { purgeScenario } from "@/server/domains/api/scenario.service";

export const runtime = "nodejs";

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:DELETE");
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return NextResponse.json(ok(await purgeScenario(ctx.projectId, id)));
  } catch (err) {
    return toResponse(err);
  }
});
