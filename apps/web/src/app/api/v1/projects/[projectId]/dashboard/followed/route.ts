import { toResponse, okResponse, withProjectScope, zodParse } from "@/server/guard";
import { dashFollowedQuerySchema } from "@rabbit/shared";
import * as svc from "@/server/domains/dash/dash.service";

/** DASH-002：我关注的——kind 七维度（case/plan/review/api_case/scenario/bug）+ 项目维度过滤。 */
export const GET = withProjectScope(async (ctx, req) => {
  try {
    const url = new URL(req.url);
    const q = zodParse(dashFollowedQuerySchema, {
      kind: url.searchParams.get("kind") ?? undefined,
      page: url.searchParams.get("page") ?? 1,
      pageSize: url.searchParams.get("pageSize") ?? 20,
    });
    return okResponse(await svc.followed(ctx.userId, ctx.projectId, q.kind, q.page, q.pageSize));
  } catch (err) {
    return toResponse(err);
  }
});
