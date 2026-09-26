import { withOrgScope, toResponse, okResponse } from '@/server/guard';
import { groupMembersSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/system/group.service';

export const POST = withOrgScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('ORG_GROUP:UPDATE');
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const body = groupMembersSchema.parse(await req.json());
    return okResponse(await svc.addMembers(id, body.userIds));
  } catch (err) { return toResponse(err); }
});
