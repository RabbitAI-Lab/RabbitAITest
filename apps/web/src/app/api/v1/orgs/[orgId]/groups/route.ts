import { toResponse, okResponse, withOrgScope } from '@/server/guard';
import { groupUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/system/group.service';

export const GET = withOrgScope(async (ctx, req) => {
  try {
    ctx.requirePerm('ORG_GROUP:READ');
    return okResponse(await svc.listGroups({ scope: 'org', orgId: ctx.orgId }, new URL(req.url).searchParams.get('withMembers') === '1' ? { withMembers: '1' } : undefined));
  } catch (err) { return toResponse(err); }
});

export const POST = withOrgScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm('ORG_GROUP:CREATE');
    const body = groupUpsertSchema.parse(await req.json());
    return okResponse(await svc.createGroup(ctx.userId, { scope: 'org', orgId: ctx.orgId }, body), 201);
  } catch (err) { return toResponse(err); }
});
