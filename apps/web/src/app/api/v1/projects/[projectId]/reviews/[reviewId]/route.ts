import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import { reviewUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/review/review.service';

export const GET = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE_REVIEW:READ');
    const { reviewId } = await (seg as { params: Promise<{ reviewId: string }> }).params;
    return okResponse(await svc.getReview(ctx.projectId, reviewId, ctx.userId));
  } catch (err) { return toResponse(err); }
});

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE_REVIEW:UPDATE');
    ctx.requireWritable();
    const { reviewId } = await (seg as { params: Promise<{ reviewId: string }> }).params;
    const body = reviewUpsertSchema.parse(await req.json());
    return okResponse(await svc.updateReview(ctx.projectId, reviewId, body));
  } catch (err) { return toResponse(err); }
});

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE_REVIEW:UPDATE');
    ctx.requireWritable();
    const { reviewId } = await (seg as { params: Promise<{ reviewId: string }> }).params;
    return okResponse(await svc.deleteReview(ctx.projectId, reviewId));
  } catch (err) { return toResponse(err); }
});
