import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import * as svc from "@/server/domains/api/swagger-sync.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

/** API-011：立即同步（手动路径；与定时同 runSync）。 */
export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:UPDATE");
    ctx.requireWritable();
    const { taskId } = await (seg as { params: Promise<{ taskId: string }> }).params;
    const result = await svc.runSync(ctx.projectId, taskId, ctx.userId);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "swagger.sync",
      objectType: "swagger_sync_task",
      objectId: taskId,
      detail: {
        added: result.added,
        updated: result.updated,
        skipped: result.skipped,
        ok: result.ok,
      },
    });
    void flushAudit();
    return okResponse(result);
  } catch (err) {
    return toResponse(err);
  }
});
