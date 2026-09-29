import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import { commentUpsertSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/case/caseDetail.service";

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    const { commentId } = await (seg as { params: Promise<{ commentId: string }> }).params;
    const body = commentUpsertSchema.parse(await req.json());
    const canModerate = ctx.permissions.has("PROJECT_CASE:UPDATE");
    return okResponse(await svc.updateComment(ctx.userId, canModerate, commentId, body.content));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    const { commentId } = await (seg as { params: Promise<{ commentId: string }> }).params;
    const canModerate = ctx.permissions.has("PROJECT_CASE:UPDATE");
    return okResponse(await svc.deleteComment(ctx.userId, canModerate, commentId));
  } catch (err) {
    return toResponse(err);
  }
});
