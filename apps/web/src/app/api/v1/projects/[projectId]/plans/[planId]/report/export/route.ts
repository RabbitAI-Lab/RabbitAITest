import { withProjectScope, toResponse } from "@/server/guard";
import { NextResponse } from "next/server";
import * as svc from "@/server/domains/plan/plan-report.service";

/** S4 PLAN-005：CSV 明细导出（attachment 下载语义非信封；UTF-8 BOM Excel 兼容）。 */
export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_PLAN:READ");
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    const { filename, csv } = await svc.exportPlanReportCsv(ctx.projectId, planId);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    }) as NextResponse;
  } catch (err) {
    return toResponse(err);
  }
});
