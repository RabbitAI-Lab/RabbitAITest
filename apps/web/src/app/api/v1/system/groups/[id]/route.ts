import { withSystemPerm, toResponse, okResponse } from "@/server/guard";
import { groupUpsertSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/system/group.service";

export const PUT = withSystemPerm("SYSTEM_GROUP:UPDATE")(async (ctx, req, seg) => {
  try {
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const body = groupUpsertSchema.parse(await req.json());
    return okResponse(await svc.updateGroup(ctx.userId, id, body));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withSystemPerm("SYSTEM_GROUP:DELETE")(async (ctx, req, seg) => {
  try {
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return okResponse(await svc.deleteGroup(id));
  } catch (err) {
    return toResponse(err);
  }
});
