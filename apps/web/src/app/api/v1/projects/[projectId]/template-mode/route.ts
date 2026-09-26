import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/project/template.service";

export const GET = withProjectScope(async (ctx, _req, _seg) => {
  try {
    ctx.requirePerm("PROJECT_TEMPLATE:READ");
    return okResponse(await svc.getTemplateMode(ctx.projectId));
  } catch (err) {
    return toResponse(err);
  }
});
