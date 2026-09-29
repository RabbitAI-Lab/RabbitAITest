import { withOrgScope, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/system/group.service";

export const DELETE = withOrgScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("ORG_GROUP:UPDATE");
    const { id, userId } = await (seg as { params: Promise<{ id: string; userId: string }> })
      .params;
    return okResponse(await svc.removeMember(id, userId));
  } catch (err) {
    return toResponse(err);
  }
});
