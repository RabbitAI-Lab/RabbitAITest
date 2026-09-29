import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/case/caseV2.service";

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE:READ");
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    return okResponse(await svc.setFollow(ctx.projectId, ctx.userId, caseId, true));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE:READ");
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    return okResponse(await svc.setFollow(ctx.projectId, ctx.userId, caseId, false));
  } catch (err) {
    return toResponse(err);
  }
});
