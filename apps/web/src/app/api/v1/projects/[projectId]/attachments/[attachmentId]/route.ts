import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/bug/bug.service";

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_BUG:UPDATE");
    ctx.requireWritable();
    const { attachmentId } = await (seg as { params: Promise<{ attachmentId: string }> }).params;
    return okResponse(await svc.deleteAttachment(ctx.projectId, attachmentId));
  } catch (err) {
    return toResponse(err);
  }
});
