import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import { runLoadTest } from "@/server/domains/exec/load.service";

export const runtime = "nodejs";

/** 触发施压（LOAD-003 §4：202 异步任务；同项目 RUNNING 互斥=90071）。 */
export const POST = withProjectScope(async (ctx, _req, segArg?: unknown) => {
  try {
    ctx.requirePerm("PROJECT_LOAD:EXECUTE");
    ctx.requireWritable();
    await assertEntpEnabled("LOAD_TEST");
    const { loadTestId } = await (
      segArg as { params: Promise<{ loadTestId: string }> }
    ).params;
    return NextResponse.json(ok(await runLoadTest(ctx.projectId, loadTestId, ctx.userId)), {
      status: 202,
    });
  } catch (err) {
    return toResponse(err);
  }
});
