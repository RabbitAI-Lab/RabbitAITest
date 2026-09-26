import { withOrgScope, toResponse, okResponse } from '@/server/guard';
import { projectMembersAddSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/project/project.service';

export const POST = withOrgScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm('ORG_MEMBER:UPDATE');
    const body = projectMembersAddSchema.parse(await req.json());
    return okResponse(await svc.addOrgMembers(ctx.orgId, body.userIds), 201);
  } catch (err) { return toResponse(err); }
});
