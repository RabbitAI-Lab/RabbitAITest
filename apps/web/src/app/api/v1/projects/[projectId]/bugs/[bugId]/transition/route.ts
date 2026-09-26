import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import { bugTransitionSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/bug/bug.service';

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_BUG:UPDATE');
    ctx.requireWritable();
    const { bugId } = await (seg as { params: Promise<{ bugId: string }> }).params;
    const body = bugTransitionSchema.parse(await req.json());
    return okResponse(await svc.transitionBug(ctx.projectId, ctx.orgId, bugId, ctx.userId, body));
  } catch (err) { return toResponse(err); }
});
