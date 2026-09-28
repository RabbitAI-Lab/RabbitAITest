import { withSystemPerm, toResponse, okResponse } from "@/server/guard";
import { userUpdateSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/system/user.service";

export const PUT = withSystemPerm("SYSTEM_USER:UPDATE")(async (ctx, req, seg) => {
  try {
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const body = userUpdateSchema.parse(await req.json());
    return okResponse(await svc.updateUser(ctx.userId, id, body));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withSystemPerm("SYSTEM_USER:DELETE")(async (ctx, req, seg) => {
  try {
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return okResponse(await svc.deleteUser(ctx.userId, id));
  } catch (err) {
    return toResponse(err);
  }
});
