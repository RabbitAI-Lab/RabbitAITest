import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import { bugUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/bug/bug.service';

export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm('PROJECT_BUG:READ');
    const { bugId } = await (seg as { params: Promise<{ bugId: string }> }).params;
    const bug = await svc.getBug(ctx.projectId, bugId);
    const transitions = await svc.allowedTransitions(ctx.projectId, ctx.orgId, bug.status);
    return okResponse({ ...bug, allowedTransitions: transitions });
  } catch (err) { return toResponse(err); }
});

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_BUG:UPDATE');
    ctx.requireWritable();
    const { bugId } = await (seg as { params: Promise<{ bugId: string }> }).params;
    const body = bugUpsertSchema.parse(await req.json());
    return okResponse(await svc.updateBug(ctx.projectId, bugId, ctx.userId, body));
  } catch (err) { return toResponse(err); }
});

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_BUG:DELETE');
    ctx.requireWritable();
    const { bugId } = await (seg as { params: Promise<{ bugId: string }> }).params;
    const purge = new URL(req.url).searchParams.get('purge') === 'true';
    if (purge) return okResponse(await svc.purgeBug(ctx.projectId, bugId));
    return okResponse(await svc.softDeleteBug(ctx.projectId, bugId));
  } catch (err) { return toResponse(err); }
});
