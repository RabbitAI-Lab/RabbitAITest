import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import { moduleUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/case/module.service';

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_CASE:READ');
    const scene = new URL(req.url).searchParams.get('scene') ?? 'case';
    return okResponse({ items: await svc.listModules(ctx.projectId, scene) });
  } catch (err) { return toResponse(err); }
});

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_CASE:UPDATE');
    ctx.requireWritable();
    const scene = new URL(req.url).searchParams.get('scene') ?? 'case';
    const body = moduleUpsertSchema.parse(await req.json());
    return okResponse(await svc.createModule(ctx.projectId, scene, body), 201);
  } catch (err) { return toResponse(err); }
});
