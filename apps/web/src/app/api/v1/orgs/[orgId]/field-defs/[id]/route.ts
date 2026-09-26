import { withOrgScope, toResponse, okResponse } from "@/server/guard";
import { fieldDefUpsertSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/project/template.service";

export const PUT = withOrgScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("ORG_TEMPLATE:UPDATE");
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const body = fieldDefUpsertSchema.parse(await req.json());
    return okResponse(await svc.updateFieldDef(ctx.orgId, id, body));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withOrgScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("ORG_TEMPLATE:UPDATE");
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return okResponse(await svc.deleteFieldDef(ctx.orgId, id));
  } catch (err) {
    return toResponse(err);
  }
});
