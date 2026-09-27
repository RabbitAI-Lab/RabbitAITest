import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import * as svc from '@/server/domains/plan/plan-group.service';

/** S4 PLAN-004：组恢复（级联成员整组恢复）。 */
export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:UPDATE');
    ctx.requireWritable();
    const { groupId } = await (seg as { params: Promise<{ groupId: string }> }).params;
    return okResponse(await svc.archivePlanGroup(ctx.projectId, groupId, false));
  } catch (err) { return toResponse(err); }
});
