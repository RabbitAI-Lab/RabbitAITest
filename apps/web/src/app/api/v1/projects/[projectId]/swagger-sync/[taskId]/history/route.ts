import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import * as svc from "@/server/domains/api/swagger-sync.service";

export const runtime = "nodejs";

/** API-011：任务同步历史（最近 20）。 */
export const GET = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:READ");
    const { taskId } = await (seg as { params: Promise<{ taskId: string }> }).params;
    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") ?? 1) || 1;
    const pageSize = Number(url.searchParams.get("pageSize") ?? 20) || 20;
    return okResponse(await svc.taskHistory(ctx.projectId, taskId, page, pageSize));
  } catch (err) {
    return toResponse(err);
  }
});
