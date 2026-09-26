import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import { moduleMoveSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/case/module.service';

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE:UPDATE');
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const scene = new URL(req.url).searchParams.get('scene') ?? 'case';
    const body = moduleMoveSchema.parse(await req.json());
    return okResponse(await svc.moveModule(ctx.projectId, scene, id, body.parentId, body.order));
  } catch (err) { return toResponse(err); }
});
