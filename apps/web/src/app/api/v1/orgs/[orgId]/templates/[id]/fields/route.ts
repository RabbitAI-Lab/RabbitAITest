import { toResponse, okResponse, withOrgScope } from '@/server/guard';
import { templateFieldsUpdateSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/project/template.service';

export const PUT = withOrgScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('ORG_TEMPLATE:UPDATE');
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const body = templateFieldsUpdateSchema.parse(await req.json());
    return okResponse(await svc.updateTemplateFields(ctx.orgId, id, body.fields));
  } catch (err) { return toResponse(err); }
});
