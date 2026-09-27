import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import * as svc from '@/server/domains/plan/plan-exec.service';

/** S4 PLAN-003：计划执行历史（ExecTask type=plan 列表，分页信封）。 */
export const GET = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:READ');
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    const url = new URL(req.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    return okResponse(await svc.listPlanExecutions(ctx.projectId, planId, page, pageSize));
  } catch (err) { return toResponse(err); }
});
