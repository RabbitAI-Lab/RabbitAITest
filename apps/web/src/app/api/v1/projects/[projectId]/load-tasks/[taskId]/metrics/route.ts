import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { loadTaskMetrics } from "@/server/domains/exec/load.service";

export const runtime = "nodejs";

/** 秒级度量时间线回放（LOAD-003 §4：Stream XRANGE；终态回落 Report.summary.metrics）。 */
export const GET = withProjectScope(async (ctx, _req, segArg?: unknown) => {
  try {
    ctx.requirePerm("PROJECT_LOAD:READ");
    const { taskId } = await (segArg as { params: Promise<{ taskId: string }> }).params;
    return NextResponse.json(ok(await loadTaskMetrics(ctx.projectId, taskId)));
  } catch (err) {
    return toResponse(err);
  }
});
