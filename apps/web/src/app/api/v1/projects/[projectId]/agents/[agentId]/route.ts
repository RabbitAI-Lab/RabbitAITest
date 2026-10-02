/** AGENT-001：Agent 详情/编辑（version 乐观锁）/软删（RUNNING 拒绝 409）。 */
import { toResponse, okResponse, withProjectScope, zodParse } from "@/server/guard";
import { agentUpdateSchema } from "@rabbit/shared";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import * as svc from "@/server/domains/agent/agent.service";
import { cleanupWorkspace } from "@/server/domains/agent/workspace";

type Seg = { params: Promise<{ agentId: string }> };

export const GET = withProjectScope(async (ctx, _req, segArg) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:READ");
    const { agentId } = await (segArg as Seg).params;
    return okResponse(await svc.getAgentView(ctx.projectId, agentId));
  } catch (err) {
    return toResponse(err);
  }
});

export const PUT = withProjectScope(async (ctx, req, segArg) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:UPDATE");
    ctx.requireWritable();
    const { agentId } = await (segArg as Seg).params;
    const body = zodParse(agentUpdateSchema, await req.json());
    const updated = await svc.updateAgent(ctx.projectId, agentId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "agent.update",
      objectType: "project_agent",
      objectId: agentId,
      detail: { name: updated.name, version: updated.version ?? null },
    });
    void flushAudit();
    return okResponse(updated);
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, segArg) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:DELETE");
    ctx.requireWritable();
    const { agentId } = await (segArg as Seg).params;
    await svc.deleteAgent(ctx.projectId, agentId);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "agent.delete",
      objectType: "project_agent",
      objectId: agentId,
      detail: {},
    });
    void flushAudit();
    void cleanupWorkspace(agentId); // 工作区清理 best-effort
    return okResponse({ deleted: true });
  } catch (err) {
    return toResponse(err);
  }
});
