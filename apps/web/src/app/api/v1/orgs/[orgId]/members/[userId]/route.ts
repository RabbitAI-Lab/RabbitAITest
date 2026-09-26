import { withOrgScope, toResponse, okResponse } from '@/server/guard';
import * as svc from '@/server/domains/project/project.service';

export const DELETE = withOrgScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('ORG_MEMBER:UPDATE');
    const { userId } = await (seg as { params: Promise<{ userId: string }> }).params;
    return okResponse(await svc.removeOrgMember(ctx.orgId, userId));
  } catch (err) { return toResponse(err); }
});
