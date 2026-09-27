import { withProjectScope, toResponse, okResponse, zodParse } from '@/server/guard';
import { planGroupUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/plan/plan-group.service';

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:UPDATE');
    ctx.requireWritable();
    const { groupId } = await (seg as { params: Promise<{ groupId: string }> }).params;
    const body = zodParse(planGroupUpsertSchema.partial(), await req.json());
    return okResponse(await svc.updatePlanGroup(ctx.projectId, groupId, body));
  } catch (err) { return toResponse(err); }
});

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:DELETE');
    ctx.requireWritable();
    const { groupId } = await (seg as { params: Promise<{ groupId: string }> }).params;
    return okResponse(await svc.deletePlanGroup(ctx.projectId, groupId));
  } catch (err) { return toResponse(err); }
});
