import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import * as follow from "@/server/domains/crosscut/follow.service";

/** S4 DASH-002：计划关注（entityType=test_plan）。 */
export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_PLAN:READ");
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    await follow.assertFollowTargetExists("test_plan", planId);
    return okResponse(await follow.setFollow(ctx.userId, "test_plan", planId, true));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_PLAN:READ");
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    return okResponse(await follow.setFollow(ctx.userId, "test_plan", planId, false));
  } catch (err) {
    return toResponse(err);
  }
});
