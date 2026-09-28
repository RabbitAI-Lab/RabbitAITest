import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/project/template.service";

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_TEMPLATE:UPDATE");
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return okResponse(await svc.copyTemplate(ctx.orgId, ctx.projectId, id), 201);
  } catch (err) {
    return toResponse(err);
  }
});
