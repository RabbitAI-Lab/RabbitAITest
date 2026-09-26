import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/case/caseDetail.service';

export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE:READ');
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    return okResponse({ items: await svc.listChanges('functional_case', caseId) });
  } catch (err) { return toResponse(err); }
});
