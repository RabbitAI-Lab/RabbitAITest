import { withProjectScope, toResponse, okResponse, zodParse } from '@/server/guard';
import { planCaseMoveSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/plan/plan-points.service';

/** S4 PLAN-002：关联用例点间移动（保留执行状态与历史）。 */
export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:UPDATE');
    ctx.requireWritable();
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    const body = zodParse(planCaseMoveSchema, await req.json());
    return okResponse(await svc.movePlanCases(ctx.projectId, planId, body.refIds, body.pointId));
  } catch (err) { return toResponse(err); }
});
