/** AGENT-001：A2A 密钥 开启/轮换（明文仅此一次）/吊销（同时关 a2aEnabled）。 */
import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import * as svc from "@/server/domains/agent/agent.service";

type Seg = { params: Promise<{ agentId: string }> };

export const POST = withProjectScope(async (ctx, _req, segArg) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:UPDATE");
    const { agentId } = await (segArg as Seg).params;
    const r = await svc.rotateAgentKey(ctx.projectId, agentId);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "agent_key.generate",
      objectType: "project_agent",
      objectId: agentId,
      detail: { prefix: r.prefix },
    });
    void flushAudit();
    return okResponse(r, 201);
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, segArg) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:UPDATE");
    const { agentId } = await (segArg as Seg).params;
    await svc.revokeAgentKey(ctx.projectId, agentId);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "agent_key.revoke",
      objectType: "project_agent",
      objectId: agentId,
      detail: {},
    });
    void flushAudit();
    return okResponse({ revoked: true });
  } catch (err) {
    return toResponse(err);
  }
});
