import { toResponse, okResponse, withSystemPerm } from '@/server/guard';
import { groupUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/system/group.service';

export const GET = withSystemPerm('SYSTEM_GROUP:READ')(async (_ctx, req) => {
  try {
    return okResponse(await svc.listGroups({ scope: 'system' }, new URL(req.url).searchParams.get('withMembers') === '1' ? { withMembers: '1' } : undefined));
  } catch (err) { return toResponse(err); }
});

export const POST = withSystemPerm('SYSTEM_GROUP:CREATE')(async (ctx, req, _seg) => {
  try {
    const body = groupUpsertSchema.parse(await req.json());
    return okResponse(await svc.createGroup(ctx.userId, { scope: 'system' }, body), 201);
  } catch (err) { return toResponse(err); }
});
