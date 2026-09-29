import { NextResponse } from "next/server";
import { ok, ErrCode, reportStatsQuerySchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { reportStats } from "@/server/domains/exec/report-stats.service";

export const runtime = "nodejs";

/** S-future RPT-004：跨报告统计（days ∈ {7,14,30}，非法 → 422·REPORT_STATS_INVALID）。 */
export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_REPORT:READ");
    const parsed = reportStatsQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    if (!parsed.success)
      return NextResponse.json(
        {
          code: ErrCode.REPORT_STATS_INVALID,
          message: parsed.error.issues[0]?.message ?? "统计窗口参数非法",
          data: null,
        },
        { status: 422 },
      );
    return NextResponse.json(ok(await reportStats(ctx.projectId, parsed.data.days as 7 | 14 | 30)));
  } catch (err) {
    return toResponse(err);
  }
});
