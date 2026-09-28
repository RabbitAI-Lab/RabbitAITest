import { okResponse, toResponse, withAuth } from "@/server/guard";
import * as svc from "@/server/domains/message/notify.service";

export const runtime = "nodejs";

/** MSG-001：未读数（铃铛 badge）。 */
export const GET = withAuth(async (ctx) => {
  try {
    return okResponse(await svc.unreadNotificationCount(ctx.userId));
  } catch (err) {
    return toResponse(err);
  }
});
