import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/review/review.service";

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE_REVIEW:UPDATE");
    ctx.requireWritable();
    const { reviewId } = await (seg as { params: Promise<{ reviewId: string }> }).params;
    return okResponse(await svc.copyReview(ctx.projectId, reviewId), 201);
  } catch (err) {
    return toResponse(err);
  }
});
