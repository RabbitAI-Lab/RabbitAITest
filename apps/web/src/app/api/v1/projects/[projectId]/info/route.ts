import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/project/project.service";

export const GET = withProjectScope(async (ctx, _req, _seg) => {
  try {
    ctx.requirePerm("PROJECT_MEMBER:READ");
    return okResponse(await svc.getProjectInfo(ctx.projectId));
  } catch (err) {
    return toResponse(err);
  }
});
