import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import { swaggerSyncTaskSaveSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/api/swagger-sync.service";

export const runtime = "nodejs";

/** API-011：任务编辑（PUT）与删除（DELETE——停用 job 不动已导入数据）。 */
export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:UPDATE");
    ctx.requireWritable();
    const { taskId } = await (seg as { params: Promise<{ taskId: string }> }).params;
    const body = swaggerSyncTaskSaveSchema.parse(await req.json());
    await svc.updateTask(ctx.projectId, taskId, body);
    return okResponse({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:UPDATE");
    const { taskId } = await (seg as { params: Promise<{ taskId: string }> }).params;
    await svc.deleteTask(ctx.projectId, taskId);
    return okResponse({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
});
