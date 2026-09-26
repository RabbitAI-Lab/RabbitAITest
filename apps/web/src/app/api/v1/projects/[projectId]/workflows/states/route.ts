import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import { workflowStateUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/project/template.service';

export const POST = withProjectScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm('PROJECT_TEMPLATE:UPDATE');
    ctx.requireWritable();
    const body = workflowStateUpsertSchema.parse(await req.json());
    return okResponse(await svc.createWorkflowState(ctx.orgId, ctx.projectId, body), 201);
  } catch (err) { return toResponse(err); }
});
