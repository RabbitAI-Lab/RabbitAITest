import { toResponse, okResponse, withProjectScope, zodParse } from "@/server/guard";
import { dashCreatedQuerySchema } from "@rabbit/shared";
import * as svc from "@/server/domains/dash/dash.service";

/** DASH-002：我创建的——修正为 createdBy=me 口径 + api_case/scenario 维度。 */
export const GET = withProjectScope(async (ctx, req) => {
  try {
    const url = new URL(req.url);
    const q = zodParse(dashCreatedQuerySchema, {
      kind: url.searchParams.get("kind") ?? undefined,
      page: url.searchParams.get("page") ?? 1,
      pageSize: url.searchParams.get("pageSize") ?? 20,
    });
    return okResponse(
      await svc.created(ctx.projectId, ctx.userId, q.kind ?? "case", q.page, q.pageSize),
    );
  } catch (err) {
    return toResponse(err);
  }
});
