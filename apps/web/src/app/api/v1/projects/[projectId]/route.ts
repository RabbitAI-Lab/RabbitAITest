import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import { projectUpdateSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/project/project.service";

export const PUT = withProjectScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm("ORG_PROJECT:UPDATE");
    ctx.requireWritable();
    const body = projectUpdateSchema.parse(await req.json());
    return okResponse(await svc.updateProject(ctx.projectId, ctx.userId, body));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, _seg) => {
  try {
    ctx.requirePerm("ORG_PROJECT:DELETE");
    return okResponse(await svc.softDeleteProject(ctx.projectId, ctx.userId));
  } catch (err) {
    return toResponse(err);
  }
});
