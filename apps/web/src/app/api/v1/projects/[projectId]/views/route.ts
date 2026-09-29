import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import { viewUpsertSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/case/pref.service";

export const GET = withProjectScope(async (ctx, _req, _seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE:READ");
    return okResponse(await svc.listViews(ctx.userId, ctx.projectId));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE:READ");
    const body = viewUpsertSchema.parse(await req.json());
    return okResponse(await svc.createView(ctx.userId, ctx.projectId, body), 201);
  } catch (err) {
    return toResponse(err);
  }
});
