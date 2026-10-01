import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { checkUiRunner } from "@/server/domains/exec/ui-runner.service";

export const runtime = "nodejs";

/** S14 UIT-004：触发环境检测（runnerId=builtin 为内置；INSTALLING 中拒绝）。 */
export const POST = withProjectScope(async (ctx, _req, segArg?: unknown) => {
  try {
    ctx.requirePerm("PROJECT_UIT:READ");
    const { runnerId } = await (segArg as { params: Promise<{ runnerId: string }> }).params;
    return NextResponse.json(ok(await checkUiRunner(ctx.projectId, runnerId)), { status: 202 });
  } catch (err) {
    return toResponse(err);
  }
});
