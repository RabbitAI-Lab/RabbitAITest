import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import * as svc from '@/server/domains/case/caseDetail.service';

export const GET = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:READ');
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    return okResponse(await svc.casePlans(ctx.projectId, caseId, ctx.userId));
  } catch (err) { return toResponse(err); }
});
