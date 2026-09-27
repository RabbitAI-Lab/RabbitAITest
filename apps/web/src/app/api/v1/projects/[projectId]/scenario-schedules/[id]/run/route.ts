import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { fireSchedule } from "@/server/domains/api/schedule.service";

export const runtime = "nodejs";

/** 立即执行（API-008 §3：同触发链路，cron 等待的验证替代路径）。 */
export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:CREATE");
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return NextResponse.json(ok(await fireSchedule(id, ctx.projectId)), { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
});
