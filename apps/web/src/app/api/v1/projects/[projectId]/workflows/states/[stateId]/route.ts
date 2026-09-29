import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import { workflowStateUpsertSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/project/template.service";

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_TEMPLATE:UPDATE");
    ctx.requireWritable();
    const { stateId } = await (seg as { params: Promise<{ stateId: string }> }).params;
    const body = workflowStateUpsertSchema.parse(await req.json());
    return okResponse(await svc.updateWorkflowState(ctx.orgId, ctx.projectId, stateId, body));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_TEMPLATE:UPDATE");
    ctx.requireWritable();
    const { stateId } = await (seg as { params: Promise<{ stateId: string }> }).params;
    return okResponse(await svc.deleteWorkflowState(ctx.orgId, ctx.projectId, stateId));
  } catch (err) {
    return toResponse(err);
  }
});
