import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import { planUpdateSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/plan/plan.service';

export const GET = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:READ');
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    return okResponse(await svc.getPlan(ctx.projectId, planId));
  } catch (err) { return toResponse(err); }
});

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:UPDATE');
    ctx.requireWritable();
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    const body = planUpdateSchema.parse(await req.json());
    return okResponse(await svc.updatePlan(ctx.projectId, planId, body));
  } catch (err) { return toResponse(err); }
});

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:DELETE');
    ctx.requireWritable();
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    return okResponse(await svc.deletePlan(ctx.projectId, planId));
  } catch (err) { return toResponse(err); }
});
