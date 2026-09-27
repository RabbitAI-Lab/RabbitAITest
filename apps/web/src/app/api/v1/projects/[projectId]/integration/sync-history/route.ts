import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import { syncHistoryQuerySchema } from "@rabbit/shared";
import * as svc from "@/server/domains/api/platform-sync.service";

export const runtime = "nodejs";

/** INTG-001/002：同步历史（AppSetting，最近 20）。 */
export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_BUG:READ");
    const url = new URL(req.url);
    const query = syncHistoryQuerySchema.parse({
      page: url.searchParams.get("page") ?? 1,
      pageSize: url.searchParams.get("pageSize") ?? 20,
    });
    return okResponse(await svc.listHistory(ctx.projectId, query.page, query.pageSize));
  } catch (err) {
    return toResponse(err);
  }
});
