import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/project/project.service";

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_MEMBER:UPDATE");
    ctx.requireWritable();
    const { userId } = await (seg as { params: Promise<{ userId: string }> }).params;
    return okResponse(await svc.removeProjectMember(ctx.projectId, ctx.userId, userId));
  } catch (err) {
    return toResponse(err);
  }
});
