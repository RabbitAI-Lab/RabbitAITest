import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { uiRunnerDetail, deleteUiRunner } from "@/server/domains/exec/ui-runner.service";

export const runtime = "nodejs";

/** S14 UIT-004：Runner 详情（含 checklist 快照与安装日志尾部；跨项目=404 防枚举）。 */
export const GET = withProjectScope(async (ctx, _req, segArg?: unknown) => {
  try {
    ctx.requirePerm("PROJECT_UIT:READ");
    const { runnerId } = await (segArg as { params: Promise<{ runnerId: string }> }).params;
    return NextResponse.json(ok(await uiRunnerDetail(ctx.projectId, runnerId)));
  } catch (err) {
    return toResponse(err);
  }
});

/** S14 UIT-004：删除（软删行 + 引擎目录清理 job；INSTALLING 拒绝）。 */
export const DELETE = withProjectScope(async (ctx, _req, segArg?: unknown) => {
  try {
    ctx.requirePerm("PROJECT_UIT:RUNNER_MANAGE");
    ctx.requireWritable();
    const { runnerId } = await (segArg as { params: Promise<{ runnerId: string }> }).params;
    return NextResponse.json(ok(await deleteUiRunner(ctx.projectId, runnerId)));
  } catch (err) {
    return toResponse(err);
  }
});
