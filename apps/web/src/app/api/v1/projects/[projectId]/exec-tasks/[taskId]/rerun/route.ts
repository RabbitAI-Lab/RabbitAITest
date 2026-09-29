import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { rerunTask } from "@/server/domains/exec/exec.service";

export const runtime = "nodejs";

export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_EXEC_TASK:UPDATE");
    ctx.requireWritable();
    const { taskId } = await (seg as { params: Promise<{ taskId: string }> }).params;
    return NextResponse.json(ok(await rerunTask(ctx.projectId, ctx.userId, taskId)), {
      status: 201,
    });
  } catch (err) {
    return toResponse(err);
  }
});
