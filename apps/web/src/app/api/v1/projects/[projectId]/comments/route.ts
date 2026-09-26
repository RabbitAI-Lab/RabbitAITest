import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import { commentUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/case/caseDetail.service';

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_CASE:READ');
    const entity = new URL(req.url).searchParams.get('entity') ?? '';
    const [entityType, entityId] = entity.split(':');
    if (!entityType || !entityId) return okResponse({ items: [] });
    return okResponse({ items: await svc.listComments(entityType, entityId) });
  } catch (err) { return toResponse(err); }
});

export const POST = withProjectScope(async (ctx, req) => {
  try {
    const entity = new URL(req.url).searchParams.get('entity') ?? '';
    const [entityType, entityId] = entity.split(':');
    if (!entityType || !entityId) return okResponse({ ok: false }, 422);
    const body = commentUpsertSchema.parse(await req.json());
    return okResponse(await svc.addComment(ctx.userId, entityType, entityId, body.content, body.parentId), 201);
  } catch (err) { return toResponse(err); }
});
