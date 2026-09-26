import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import * as svc from '@/server/domains/system/group.service';

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_GROUP:UPDATE');
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return okResponse(await svc.restoreGroupDefault(id));
  } catch (err) { return toResponse(err); }
});
