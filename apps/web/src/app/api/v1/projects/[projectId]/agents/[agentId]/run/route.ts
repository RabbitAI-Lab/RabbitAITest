/** AGENT-001：调试台发消息（chat 模式单轮 Run）→ {runId}。 */
import { toResponse, okResponse, withProjectScope, zodParse } from "@/server/guard";
import { agentRunCreateSchema } from "@rabbit/shared";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import * as svc from "@/server/domains/agent/run.service";

type Seg = { params: Promise<{ agentId: string }> };

export const POST = withProjectScope(async (ctx, req, segArg) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:RUN");
    const { agentId } = await (segArg as Seg).params;
    const body = zodParse(agentRunCreateSchema, await req.json());
    const r = await svc.createRun(ctx.projectId, agentId, ctx.userId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "agent.run.create",
      objectType: "agent_run",
      objectId: r.runId,
      detail: { agentId, source: "UI" },
    });
    void flushAudit();
    return okResponse(r, 201);
  } catch (err) {
    return toResponse(err);
  }
});
