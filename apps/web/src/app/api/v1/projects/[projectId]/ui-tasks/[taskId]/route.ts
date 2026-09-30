import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { uiTaskDetail } from "@/server/domains/exec/uit.service";

export const runtime = "nodejs";

/** UI 任务详情（UIT-002 §4：帧→步骤视图聚合；ui-screenshot 帧 fileId 供报告页取图）。 */
export const GET = withProjectScope(async (ctx, _req, segArg?: unknown) => {
  try {
    ctx.requirePerm("PROJECT_UIT:READ");
    const { taskId } = await (segArg as { params: Promise<{ taskId: string }> }).params;
    return NextResponse.json(ok(await uiTaskDetail(ctx.projectId, taskId)));
  } catch (err) {
    return toResponse(err);
  }
});
