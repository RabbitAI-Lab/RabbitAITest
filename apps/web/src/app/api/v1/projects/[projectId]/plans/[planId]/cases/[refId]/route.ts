import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import * as svc from '@/server/domains/plan/plan.service';

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:UPDATE');
    ctx.requireWritable();
    const { planId, refId } = await (seg as { params: Promise<{ planId: string; refId: string }> }).params;
    return okResponse(await svc.removePlanCase(ctx.projectId, planId, refId));
  } catch (err) { return toResponse(err); }
});
