import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import * as svc from '@/server/domains/case/caseDetail.service';

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_BUG:UPDATE');
    ctx.requireWritable();
    const { caseId, bugId } = await (seg as { params: Promise<{ caseId: string; bugId: string }> }).params;
    return okResponse(await svc.unlinkCaseBug(ctx.projectId, caseId, bugId));
  } catch (err) { return toResponse(err); }
});
