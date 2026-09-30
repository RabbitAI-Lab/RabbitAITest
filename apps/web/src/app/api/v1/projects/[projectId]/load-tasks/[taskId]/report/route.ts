import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { loadReportDetail } from "@/server/domains/exec/load.service";

export const runtime = "nodejs";

/** 压测报告详情（LOAD-003 §4：summary.metrics 全量时间线+阈值逐项结论）。 */
export const GET = withProjectScope(async (ctx, _req, segArg?: unknown) => {
  try {
    ctx.requirePerm("PROJECT_LOAD:READ");
    const { taskId } = await (segArg as { params: Promise<{ taskId: string }> }).params;
    return NextResponse.json(ok(await loadReportDetail(ctx.projectId, taskId)));
  } catch (err) {
    return toResponse(err);
  }
});
