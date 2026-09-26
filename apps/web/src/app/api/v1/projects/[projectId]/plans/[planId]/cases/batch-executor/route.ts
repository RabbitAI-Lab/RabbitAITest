import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import { planBatchExecutorSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/plan/plan.service";

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_PLAN:UPDATE");
    ctx.requireWritable();
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    const body = planBatchExecutorSchema.parse(await req.json());
    return okResponse(await svc.batchExecutor(ctx.projectId, planId, body.refIds, body.execUserId));
  } catch (err) {
    return toResponse(err);
  }
});
