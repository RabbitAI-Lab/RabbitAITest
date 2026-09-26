import { withOrgScope, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/project/template.service";

export const POST = withOrgScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("ORG_TEMPLATE:UPDATE");
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return okResponse(await svc.setDefaultTemplate(ctx.orgId, null, id));
  } catch (err) {
    return toResponse(err);
  }
});
