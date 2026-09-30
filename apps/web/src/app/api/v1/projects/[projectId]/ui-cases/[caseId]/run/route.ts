import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import { runUiCase } from "@/server/domains/exec/uit.service";

export const runtime = "nodejs";

/** 单用例执行（UIT-002 §4：202 异步任务，ui_case 命令入 exec 队列）。 */
export const POST = withProjectScope(async (ctx, _req, segArg?: unknown) => {
  try {
    ctx.requirePerm("PROJECT_UIT:EXECUTE");
    ctx.requireWritable();
    await assertEntpEnabled("UI_TEST");
    const { caseId } = await (segArg as { params: Promise<{ caseId: string }> }).params;
    return NextResponse.json(ok(await runUiCase(ctx.projectId, caseId, ctx.userId)), {
      status: 202,
    });
  } catch (err) {
    return toResponse(err);
  }
});
