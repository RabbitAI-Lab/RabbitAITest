import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/review/review.service";

export const GET = withProjectScope(async (ctx, _req, _seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE_REVIEW:READ");
    return okResponse(await svc.getReviewSetting(ctx.projectId));
  } catch (err) {
    return toResponse(err);
  }
});

export const PUT = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_CASE_REVIEW:UPDATE");
    ctx.requireWritable();
    const body = (await req.json()) as { enabled?: boolean };
    return okResponse(await svc.setReviewSetting(ctx.projectId, Boolean(body.enabled)));
  } catch (err) {
    return toResponse(err);
  }
});
