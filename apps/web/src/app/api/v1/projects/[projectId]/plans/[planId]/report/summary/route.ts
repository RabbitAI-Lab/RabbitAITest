import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import { planReportSummarySchema } from '@rabbit/shared';
import * as svc from '@/server/domains/plan/plan.service';

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:UPDATE');
    ctx.requireWritable();
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    const body = planReportSummarySchema.parse(await req.json());
    return okResponse(await svc.updatePlanReportSummary(ctx.projectId, planId, body.summary));
  } catch (err) { return toResponse(err); }
});
