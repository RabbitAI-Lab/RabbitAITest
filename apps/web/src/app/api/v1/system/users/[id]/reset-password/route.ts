import { withSystemPerm, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/system/user.service";

export const POST = withSystemPerm("SYSTEM_USER:UPDATE")(async (ctx, req, seg) => {
  try {
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return okResponse(await svc.resetPassword(ctx.userId, id));
  } catch (err) {
    return toResponse(err);
  }
});
