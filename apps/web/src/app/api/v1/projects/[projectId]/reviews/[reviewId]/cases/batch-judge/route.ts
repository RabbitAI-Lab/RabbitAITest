import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import { reviewBatchJudgeSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/review/review.service';

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE_REVIEW:UPDATE');
    ctx.requireWritable();
    const { reviewId } = await (seg as { params: Promise<{ reviewId: string }> }).params;
    const body = reviewBatchJudgeSchema.parse(await req.json());
    return okResponse(await svc.batchJudge(ctx.projectId, reviewId, ctx.userId, body.caseIds, body));
  } catch (err) { return toResponse(err); }
});
