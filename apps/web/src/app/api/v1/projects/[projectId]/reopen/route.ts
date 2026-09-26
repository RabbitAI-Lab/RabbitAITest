import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import * as svc from '@/server/domains/project/project.service';

export const POST = withProjectScope(async (ctx, _req, _seg) => {
  try {
    ctx.requirePerm('ORG_PROJECT:UPDATE');
    return okResponse(await svc.setProjectEnded(ctx.projectId, ctx.userId, false));
  } catch (err) { return toResponse(err); }
});
