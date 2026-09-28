import { okResponse, toResponse, withProjectScope, zodParse } from "@/server/guard";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { globalParamsUpsertSchema } from "@rabbit/shared";
import * as envSvc from "@/server/domains/project/environment.service";

export const runtime = "nodejs";

/** PROJ-006：全局参数（项目级单例；作用域链=临时>环境变量>全局参数，buildEnvSnapshot 既有合并）。 */
export const GET = withProjectScope(async (ctx) => {
  try {
    ctx.requirePerm("PROJECT_ENV:READ");
    return okResponse(await envSvc.getGlobalParams(ctx.projectId));
  } catch (err) {
    return toResponse(err);
  }
});

export const PUT = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_ENV:UPDATE");
    ctx.requireWritable();
    const body = zodParse(globalParamsUpsertSchema, await req.json());
    const saved = await envSvc.upsertGlobalParams(ctx.projectId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "global_params.update",
      objectType: "global_param",
      objectId: ctx.projectId,
      detail: { count: body.params.length },
    });
    void flushAudit();
    return okResponse(saved);
  } catch (err) {
    return toResponse(err);
  }
});
