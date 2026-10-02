/** AGENT-001：取消进行中运行（Redis 标志位；终态拒 409）。 */
import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import * as svc from "@/server/domains/agent/run.service";

type Seg = { params: Promise<{ runId: string }> };

export const POST = withProjectScope(async (ctx, _req, segArg) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:RUN");
    const { runId } = await (segArg as Seg).params;
    await svc.cancelRun(ctx.projectId, runId);
    return okResponse({ canceled: true });
  } catch (err) {
    return toResponse(err);
  }
});
