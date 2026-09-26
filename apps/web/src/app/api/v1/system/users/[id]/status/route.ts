import { withSystemPerm, toResponse, okResponse } from "@/server/guard";
import { userStatusSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/system/user.service";

export const POST = withSystemPerm("SYSTEM_USER:UPDATE")(async (ctx, req, seg) => {
  try {
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const body = userStatusSchema.parse(await req.json());
    return okResponse(await svc.setUserStatus(ctx.userId, id, body.status));
  } catch (err) {
    return toResponse(err);
  }
});
