/** AGENT-001：技能 编辑/软删（被引用删除 → 409）。 */
import { toResponse, okResponse, withProjectScope, zodParse } from "@/server/guard";
import { agentSkillUpdateSchema } from "@rabbit/shared";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import * as svc from "@/server/domains/agent/skill.service";

type Seg = { params: Promise<{ skillId: string }> };

export const PUT = withProjectScope(async (ctx, req, segArg) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:UPDATE");
    ctx.requireWritable();
    const { skillId } = await (segArg as Seg).params;
    const body = zodParse(agentSkillUpdateSchema, await req.json());
    const updated = await svc.updateSkill(ctx.projectId, skillId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "agent_skill.update",
      objectType: "agent_skill",
      objectId: skillId,
      detail: { name: updated.name },
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
    const { skillId } = await (segArg as Seg).params;
    await svc.deleteSkill(ctx.projectId, skillId);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "agent_skill.delete",
      objectType: "agent_skill",
      objectId: skillId,
      detail: {},
    });
    void flushAudit();
    return okResponse({ deleted: true });
  } catch (err) {
    return toResponse(err);
  }
});
