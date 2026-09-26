import { withSystemPerm, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/system/group.service";

export const POST = withSystemPerm("SYSTEM_GROUP:UPDATE")(async (ctx, req, seg) => {
  try {
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return okResponse(await svc.restoreGroupDefault(id));
  } catch (err) {
    return toResponse(err);
  }
});
