import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/project/project.service";

// allowDeleted：本端点作用于已软删项目（撤销恢复），项目作用域守卫需放行 deletedAt 非空
export const POST = withProjectScope(
  async (ctx, _req, _seg) => {
    try {
      ctx.requirePerm("ORG_PROJECT:DELETE");
      return okResponse(await svc.restoreProject(ctx.projectId, ctx.userId));
    } catch (err) {
      return toResponse(err);
    }
  },
  { allowDeleted: true },
);
