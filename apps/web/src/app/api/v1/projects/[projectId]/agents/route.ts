/** AGENT-001：项目 Agent 列表/新建（可 fromTemplate）。 */
import { toResponse, okResponse, withProjectScope, zodParse } from "@/server/guard";
import { agentCreateSchema } from "@rabbit/shared";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import * as svc from "@/server/domains/agent/agent.service";

export const GET = withProjectScope(async (ctx) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:READ");
    return okResponse(await svc.listAgents(ctx.projectId));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:CREATE");
    ctx.requireWritable();
    const body = zodParse(agentCreateSchema, await req.json());
    const created = await svc.createAgent(ctx.projectId, ctx.userId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "agent.create",
      objectType: "project_agent",
      objectId: created.id,
      detail: {
        name: created.name,
        mode: created.mode,
        role: created.role,
        fromTemplate: body.fromTemplate ?? null,
      },
    });
    void flushAudit();
    return okResponse(created, 201);
  } catch (err) {
    return toResponse(err);
  }
});
