import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import * as svc from '@/server/domains/plan/plan-report.service';

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:READ');
    const { planId, token } = await (seg as { params: Promise<{ planId: string; token: string }> }).params;
    return okResponse(await svc.revokePlanShare(ctx.projectId, planId, token));
  } catch (err) { return toResponse(err); }
});
