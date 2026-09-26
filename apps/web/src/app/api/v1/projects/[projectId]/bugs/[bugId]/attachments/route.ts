import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/bug/bug.service";

export const GET = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_BUG:READ");
    const { bugId } = await (seg as { params: Promise<{ bugId: string }> }).params;
    return okResponse(await svc.listAttachments("bug", bugId));
  } catch (err) {
    return toResponse(err);
  }
});
