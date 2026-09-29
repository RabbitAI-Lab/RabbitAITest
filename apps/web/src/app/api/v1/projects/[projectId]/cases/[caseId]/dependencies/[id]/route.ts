import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/case/caseDetail.service";

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE:UPDATE");
    ctx.requireWritable();
    const { caseId, id } = await (seg as { params: Promise<{ caseId: string; id: string }> })
      .params;
    return okResponse(await svc.removeDependency(ctx.projectId, id));
  } catch (err) {
    return toResponse(err);
  }
});
