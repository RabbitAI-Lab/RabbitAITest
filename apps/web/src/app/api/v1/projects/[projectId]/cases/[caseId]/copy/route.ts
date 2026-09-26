import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import * as svc from '@/server/domains/case/caseV2.service';

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE:CREATE');
    ctx.requireWritable();
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    return okResponse(await svc.copyCase(ctx.projectId, ctx.userId, caseId), 201);
  } catch (err) { return toResponse(err); }
});
