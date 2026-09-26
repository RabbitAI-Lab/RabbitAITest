import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/bug/bug.service';

export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm('PROJECT_BUG:READ');
    const { bugId } = await (seg as { params: Promise<{ bugId: string }> }).params;
    return okResponse({ items: await svc.listBugChanges(ctx.projectId, bugId) });
  } catch (err) { return toResponse(err); }
});
