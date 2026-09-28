import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import { planExecSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/plan/plan.service";

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_PLAN:UPDATE");
    ctx.requireWritable();
    const { planId, refId } = await (seg as { params: Promise<{ planId: string; refId: string }> })
      .params;
    const body = planExecSchema.parse(await req.json());
    return okResponse(await svc.execPlanCase(ctx.projectId, planId, refId, ctx.userId, body));
  } catch (err) {
    return toResponse(err);
  }
});
