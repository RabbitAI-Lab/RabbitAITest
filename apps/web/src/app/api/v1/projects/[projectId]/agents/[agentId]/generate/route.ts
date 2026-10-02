/** AGENT-002：发起生成管线（POST /generate → {runId}）。 */
import { toResponse, okResponse, withProjectScope, zodParse } from "@/server/guard";
import { genRunRequestSchema } from "@rabbit/shared";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { startPipelineRun } from "@/server/domains/agent/pipeline/executor";

type Seg = { params: Promise<{ agentId: string }> };

export const POST = withProjectScope(async (ctx, req, segArg) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:RUN");
    ctx.requireWritable();
    const { agentId } = await (segArg as Seg).params;
    const body = zodParse(genRunRequestSchema, await req.json());
    const r = await startPipelineRun(ctx.projectId, agentId, ctx.userId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "agent_gen.run",
      objectType: "agent_run",
      objectId: r.runId,
      detail: { agentId, stages: body.stages ?? "default" },
    });
    void flushAudit();
    return okResponse(r, 201);
  } catch (err) {
    return toResponse(err);
  }
});
