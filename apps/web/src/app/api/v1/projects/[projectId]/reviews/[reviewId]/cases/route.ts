import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import { reviewCasesAddSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/review/review.service";

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE_REVIEW:UPDATE");
    ctx.requireWritable();
    const { reviewId } = await (seg as { params: Promise<{ reviewId: string }> }).params;
    const body = reviewCasesAddSchema.parse(await req.json());
    return okResponse(await svc.addReviewCases(ctx.projectId, reviewId, body.caseIds));
  } catch (err) {
    return toResponse(err);
  }
});
