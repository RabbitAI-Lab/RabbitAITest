import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import * as follow from "@/server/domains/crosscut/follow.service";

/** S4 DASH-002：场景关注（S3 登记去向兑现；entityType=scenario）。 */
export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:READ");
    const { id: scenarioId } = await (seg as { params: Promise<{ id: string }> }).params;
    await follow.assertFollowTargetExists("scenario", scenarioId);
    return okResponse(await follow.setFollow(ctx.userId, "scenario", scenarioId, true));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:READ");
    const { id: scenarioId } = await (seg as { params: Promise<{ id: string }> }).params;
    return okResponse(await follow.setFollow(ctx.userId, "scenario", scenarioId, false));
  } catch (err) {
    return toResponse(err);
  }
});
