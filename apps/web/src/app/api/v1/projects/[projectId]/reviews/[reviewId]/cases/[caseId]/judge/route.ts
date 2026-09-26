import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import { reviewJudgeSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/review/review.service";

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE_REVIEW:UPDATE");
    ctx.requireWritable();
    const { reviewId, caseId } = await (
      seg as { params: Promise<{ reviewId: string; caseId: string }> }
    ).params;
    const body = reviewJudgeSchema.parse(await req.json());
    return okResponse(await svc.judgeReviewCase(ctx.projectId, reviewId, caseId, ctx.userId, body));
  } catch (err) {
    return toResponse(err);
  }
});
