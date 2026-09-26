import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import { viewUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/case/pref.service';

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE:READ');
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const body = viewUpsertSchema.parse(await req.json());
    return okResponse(await svc.updateView(ctx.userId, ctx.projectId, id, body));
  } catch (err) { return toResponse(err); }
});

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE:READ');
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return okResponse(await svc.deleteView(ctx.userId, ctx.projectId, id));
  } catch (err) { return toResponse(err); }
});
