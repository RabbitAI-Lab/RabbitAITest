import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/project/template.service";

export const POST = withProjectScope(async (ctx, _req, _seg) => {
  try {
    ctx.requirePerm("PROJECT_TEMPLATE:UPDATE");
    ctx.requireWritable();
    return okResponse(await svc.enableProjectTemplateMode(ctx.orgId, ctx.projectId, ctx.userId));
  } catch (err) {
    return toResponse(err);
  }
});
