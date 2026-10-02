/** AGENT-001：Agent 运行记录（分页+status/source 过滤）。 */
import { toResponse, okResponse, withProjectScope, zodParse } from "@/server/guard";
import { agentRunQuerySchema } from "@rabbit/shared";
import * as svc from "@/server/domains/agent/run.service";

type Seg = { params: Promise<{ agentId: string }> };

export const GET = withProjectScope(async (ctx, req, segArg) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:READ");
    const { agentId } = await (segArg as Seg).params;
    const url = new URL(req.url);
    const q = zodParse(agentRunQuerySchema, {
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      source: url.searchParams.get("source") ?? undefined,
    });
    return okResponse(await svc.listRuns(ctx.projectId, agentId, q));
  } catch (err) {
    return toResponse(err);
  }
});
