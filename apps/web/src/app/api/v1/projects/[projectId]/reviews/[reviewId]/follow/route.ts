import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import * as follow from '@/server/domains/crosscut/follow.service';

/** S4 DASH-002：评审关注（entityType=case_review）。 */
export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE_REVIEW:READ');
    const { reviewId } = await (seg as { params: Promise<{ reviewId: string }> }).params;
    await follow.assertFollowTargetExists('case_review', reviewId);
    return okResponse(await follow.setFollow(ctx.userId, 'case_review', reviewId, true));
  } catch (err) { return toResponse(err); }
});

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE_REVIEW:READ');
    const { reviewId } = await (seg as { params: Promise<{ reviewId: string }> }).params;
    return okResponse(await follow.setFollow(ctx.userId, 'case_review', reviewId, false));
  } catch (err) { return toResponse(err); }
});
