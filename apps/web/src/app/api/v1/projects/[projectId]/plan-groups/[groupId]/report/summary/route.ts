import { withProjectScope, toResponse, okResponse, zodParse } from "@/server/guard";
import { planReportSummarySchema } from "@rabbit/shared";
import * as svc from "@/server/domains/plan/plan-group.service";

/** S4 PLAN-004：组报告总结编辑保存。 */
export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_PLAN:UPDATE");
    ctx.requireWritable();
    const { groupId } = await (seg as { params: Promise<{ groupId: string }> }).params;
    const body = zodParse(planReportSummarySchema, await req.json());
    return okResponse(await svc.updatePlanGroupReportSummary(ctx.projectId, groupId, body.summary));
  } catch (err) {
    return toResponse(err);
  }
});
