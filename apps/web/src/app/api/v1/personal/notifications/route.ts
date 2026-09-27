import { okResponse, toResponse, withAuth } from "@/server/guard";
import * as svc from "@/server/domains/message/notify.service";

export const runtime = "nodejs";

/** MSG-001：我的通知列表（近 90 天；?page&pageSize&unread）。 */
export const GET = withAuth(async (ctx, req: Request) => {
  try {
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? 20) || 20));
    const unread = url.searchParams.get("unread") === "true";
    return okResponse(await svc.listNotifications(ctx.userId, { page, pageSize, unread }));
  } catch (err) {
    return toResponse(err);
  }
});
