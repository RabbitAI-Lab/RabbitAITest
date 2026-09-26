import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/plan/plan.service";

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_PLAN:UPDATE");
    ctx.requireWritable();
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    return okResponse(await svc.archivePlan(ctx.projectId, planId, true));
  } catch (err) {
    return toResponse(err);
  }
});
