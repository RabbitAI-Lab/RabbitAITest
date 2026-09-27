import { withProjectScope, toResponse, okResponse, zodParse } from '@/server/guard';
import { planMoveGroupSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/plan/plan-group.service';

/** S4 PLAN-004：计划移入/移出分组。 */
export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:UPDATE');
    ctx.requireWritable();
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    const body = zodParse(planMoveGroupSchema, await req.json());
    return okResponse(await svc.movePlanGroup(ctx.projectId, planId, body.groupId));
  } catch (err) { return toResponse(err); }
});
