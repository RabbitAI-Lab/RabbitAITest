import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/plan/plan-group.service";

/** S4 PLAN-004：组聚合报告（汇总卡+成员明细+组总结）。 */
export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_PLAN:READ");
    const { groupId } = await (seg as { params: Promise<{ groupId: string }> }).params;
    return okResponse(await svc.getPlanGroupReport(ctx.projectId, groupId));
  } catch (err) {
    return toResponse(err);
  }
});
