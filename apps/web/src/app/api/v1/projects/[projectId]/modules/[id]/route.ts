import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import { moduleUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/case/module.service';

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE:UPDATE');
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const scene = new URL(req.url).searchParams.get('scene') ?? 'case';
    const body = moduleUpsertSchema.parse(await req.json());
    return okResponse(await svc.renameModule(ctx.projectId, scene, id, body.name));
  } catch (err) { return toResponse(err); }
});

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE:UPDATE');
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const scene = new URL(req.url).searchParams.get('scene') ?? 'case';
    return okResponse(await svc.deleteModule(ctx.projectId, scene, id));
  } catch (err) { return toResponse(err); }
});
