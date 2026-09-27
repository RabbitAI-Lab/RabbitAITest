import { okResponse, toResponse, withAuth } from "@/server/guard";
import * as svc from "@/server/domains/message/notify.service";

export const runtime = "nodejs";

/** MSG-001：全部已读（窗口内）。 */
export const POST = withAuth(async (ctx) => {
  try {
    return okResponse(await svc.markAllNotificationsRead(ctx.userId));
  } catch (err) {
    return toResponse(err);
  }
});
