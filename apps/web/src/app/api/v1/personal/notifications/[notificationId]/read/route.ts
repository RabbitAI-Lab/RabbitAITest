import { okResponse, toResponse, withAuth } from "@/server/guard";
import * as svc from "@/server/domains/message/notify.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ notificationId: string }> };

/** MSG-001：单条标记已读（幂等；越域/不存在 404）。 */
export const POST = withAuth(async (ctx, _req, seg) => {
  try {
    const { notificationId } = await (seg as Seg).params;
    return okResponse(await svc.markNotificationRead(ctx.userId, notificationId));
  } catch (err) {
    return toResponse(err);
  }
});
