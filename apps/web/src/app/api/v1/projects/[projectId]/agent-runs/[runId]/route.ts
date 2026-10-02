/** AGENT-001：运行详情（轨迹+产物）。 */
import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import * as svc from "@/server/domains/agent/run.service";

type Seg = { params: Promise<{ runId: string }> };

export const GET = withProjectScope(async (ctx, _req, segArg) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:READ");
    const { runId } = await (segArg as Seg).params;
    return okResponse(await svc.getRunDetail(ctx.projectId, runId));
  } catch (err) {
    return toResponse(err);
  }
});
