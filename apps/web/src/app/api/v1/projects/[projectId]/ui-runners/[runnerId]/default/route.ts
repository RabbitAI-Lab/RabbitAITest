import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { setDefaultUiRunner } from "@/server/domains/exec/ui-runner.service";

export const runtime = "nodejs";

/** S14 UIT-004：设为项目默认 runner（项目内至多一个；仅 READY 可设）。 */
export const PATCH = withProjectScope(async (ctx, _req, segArg?: unknown) => {
  try {
    ctx.requirePerm("PROJECT_UIT:RUNNER_MANAGE");
    ctx.requireWritable();
    const { runnerId } = await (segArg as { params: Promise<{ runnerId: string }> }).params;
    return NextResponse.json(ok(await setDefaultUiRunner(ctx.projectId, runnerId)));
  } catch (err) {
    return toResponse(err);
  }
});
