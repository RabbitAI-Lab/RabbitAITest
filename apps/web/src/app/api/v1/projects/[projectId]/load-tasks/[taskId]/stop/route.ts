import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import { stopLoadTask } from "@/server/domains/exec/load.service";

export const runtime = "nodejs";

/** 即时停止（LOAD-003 §2：≤2s 停发压并上报已发总量；非 RUNNING=90072）。 */
export const POST = withProjectScope(async (ctx, _req, segArg?: unknown) => {
  try {
    ctx.requirePerm("PROJECT_LOAD:EXECUTE");
    ctx.requireWritable();
    await assertEntpEnabled("LOAD_TEST");
    const { taskId } = await (segArg as { params: Promise<{ taskId: string }> }).params;
    return NextResponse.json(ok(await stopLoadTask(ctx.projectId, taskId, ctx.userId)));
  } catch (err) {
    return toResponse(err);
  }
});
