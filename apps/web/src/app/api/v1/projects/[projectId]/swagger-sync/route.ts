import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import { swaggerSyncTaskSaveSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/api/swagger-sync.service";

export const runtime = "nodejs";

/** API-011：同步任务列表。 */
export const GET = withProjectScope(async (ctx) => {
  try {
    ctx.requirePerm("PROJECT_API:READ");
    return okResponse(await svc.listTasks(ctx.projectId));
  } catch (err) {
    return toResponse(err);
  }
});

/** API-011：新建任务（上限 10 · 40524；URL 守卫 · 40521；cron 校验）。 */
export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_API:UPDATE");
    ctx.requireWritable();
    const body = swaggerSyncTaskSaveSchema.parse(await req.json());
    return okResponse(await svc.createTask(ctx.projectId, body), 201);
  } catch (err) {
    return toResponse(err);
  }
});
