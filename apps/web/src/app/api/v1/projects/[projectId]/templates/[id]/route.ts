import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import { templateUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/project/template.service';

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_TEMPLATE:UPDATE');
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const body = templateUpsertSchema.parse(await req.json());
    return okResponse(await svc.updateTemplate(ctx.orgId, id, body));
  } catch (err) { return toResponse(err); }
});

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_TEMPLATE:UPDATE');
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return okResponse(await svc.deleteTemplate(ctx.orgId, ctx.projectId, id));
  } catch (err) { return toResponse(err); }
});
