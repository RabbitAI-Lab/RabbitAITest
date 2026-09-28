import { withOrgScope, toResponse, okResponse } from "@/server/guard";
import { templateUpsertSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/project/template.service";

export const PUT = withOrgScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("ORG_TEMPLATE:UPDATE");
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const body = templateUpsertSchema.parse(await req.json());
    return okResponse(await svc.updateTemplate(ctx.orgId, id, body));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withOrgScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("ORG_TEMPLATE:UPDATE");
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return okResponse(await svc.deleteTemplate(ctx.orgId, null, id));
  } catch (err) {
    return toResponse(err);
  }
});
