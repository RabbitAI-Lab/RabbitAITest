import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/bug/bug.service";

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_BUG:UPDATE");
    ctx.requireWritable();
    const { bugId, caseId } = await (seg as { params: Promise<{ bugId: string; caseId: string }> })
      .params;
    return okResponse(await svc.unlinkBugCase(ctx.projectId, bugId, caseId));
  } catch (err) {
    return toResponse(err);
  }
});
