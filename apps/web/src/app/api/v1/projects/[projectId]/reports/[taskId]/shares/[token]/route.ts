import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { revokeShare } from "@/server/domains/exec/exec.service";

export const runtime = "nodejs";

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_REPORT:SHARE");
    ctx.requireWritable();
    const { taskId, token } = await (
      seg as { params: Promise<{ taskId: string; token: string }> }
    ).params;
    return NextResponse.json(ok(await revokeShare(ctx.projectId, taskId, token)));
  } catch (err) {
    return toResponse(err);
  }
});
