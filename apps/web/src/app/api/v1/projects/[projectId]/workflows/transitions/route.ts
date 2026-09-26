import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import { workflowTransitionsUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/project/template.service';

export const PUT = withProjectScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm('PROJECT_TEMPLATE:UPDATE');
    ctx.requireWritable();
    const body = workflowTransitionsUpsertSchema.parse(await req.json());
    return okResponse(await svc.updateWorkflowTransitions(ctx.orgId, ctx.projectId, body.transitions));
  } catch (err) { return toResponse(err); }
});
