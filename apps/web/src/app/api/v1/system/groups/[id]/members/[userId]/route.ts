import { withSystemPerm, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/system/group.service";

export const DELETE = withSystemPerm("SYSTEM_GROUP:UPDATE")(async (ctx, req, seg) => {
  try {
    const { id, userId } = await (seg as { params: Promise<{ id: string; userId: string }> })
      .params;
    return okResponse(await svc.removeMember(id, userId));
  } catch (err) {
    return toResponse(err);
  }
});
