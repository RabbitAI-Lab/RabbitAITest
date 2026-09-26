import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/review/review.service";

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE_REVIEW:UPDATE");
    ctx.requireWritable();
    const { reviewId, caseId } = await (
      seg as { params: Promise<{ reviewId: string; caseId: string }> }
    ).params;
    return okResponse(await svc.removeReviewCase(ctx.projectId, reviewId, caseId));
  } catch (err) {
    return toResponse(err);
  }
});
