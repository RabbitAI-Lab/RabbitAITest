import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import * as svc from '@/server/domains/plan/plan-report.service';

/** S4 PLAN-005：一键总结草稿（模板统计生成；不落库，保存走既有 summary 端点）。 */
export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:READ');
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    return okResponse(await svc.buildSummaryDraft(ctx.projectId, planId));
  } catch (err) { return toResponse(err); }
});
