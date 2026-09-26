import { toResponse, okResponse, withOrgScope } from '@/server/guard';
import { fieldDefUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/project/template.service';

export const GET = withOrgScope(async (ctx, req) => {
  try {
    ctx.requirePerm('ORG_TEMPLATE:READ');
    return okResponse(await svc.listFieldDefs(ctx.orgId, new URL(req.url).searchParams.get('scene') ?? undefined));
  } catch (err) { return toResponse(err); }
});

export const POST = withOrgScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm('ORG_TEMPLATE:UPDATE');
    const body = fieldDefUpsertSchema.parse(await req.json());
    return okResponse(await svc.createFieldDef(ctx.orgId, body), 201);
  } catch (err) { return toResponse(err); }
});
