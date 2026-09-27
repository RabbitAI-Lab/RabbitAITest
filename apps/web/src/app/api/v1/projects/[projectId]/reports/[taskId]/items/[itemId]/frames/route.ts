import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { itemFrames } from "@/server/domains/exec/exec.service";

export const runtime = "nodejs";

export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_REPORT:READ");
    const { taskId, itemId } = await (
      seg as { params: Promise<{ taskId: string; itemId: string }> }
    ).params;
    return NextResponse.json(ok(await itemFrames(ctx.projectId, taskId, itemId)));
  } catch (err) {
    return toResponse(err);
  }
});
