import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import { planCasesAddSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/plan/plan.service';

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:UPDATE');
    ctx.requireWritable();
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    const body = planCasesAddSchema.parse(await req.json());
    return okResponse(await svc.addPlanCases(ctx.projectId, planId, body.caseIds, body.execUserId));
  } catch (err) { return toResponse(err); }
});
