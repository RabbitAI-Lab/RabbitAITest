import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import * as follow from "@/server/domains/crosscut/follow.service";

/** S4 DASH-002：接口用例关注（entityType=api_case）。 */
export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:READ");
    const { caseId } = await (seg as { params: Promise<{ apiId: string; caseId: string }> }).params;
    await follow.assertFollowTargetExists("api_case", caseId);
    return okResponse(await follow.setFollow(ctx.userId, "api_case", caseId, true));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:READ");
    const { caseId } = await (seg as { params: Promise<{ apiId: string; caseId: string }> }).params;
    return okResponse(await follow.setFollow(ctx.userId, "api_case", caseId, false));
  } catch (err) {
    return toResponse(err);
  }
});
