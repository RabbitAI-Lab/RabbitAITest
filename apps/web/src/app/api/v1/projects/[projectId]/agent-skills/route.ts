/** AGENT-001：技能库 列表/新建（name 项目内唯一）。 */
import { toResponse, okResponse, withProjectScope, zodParse } from "@/server/guard";
import { agentSkillCreateSchema } from "@rabbit/shared";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import * as svc from "@/server/domains/agent/skill.service";

export const GET = withProjectScope(async (ctx) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:READ");
    return okResponse(await svc.listSkills(ctx.projectId));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:CREATE");
    ctx.requireWritable();
    const body = zodParse(agentSkillCreateSchema, await req.json());
    const created = await svc.createSkill(ctx.projectId, ctx.userId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "agent_skill.create",
      objectType: "agent_skill",
      objectId: created.id,
      detail: { name: created.name },
    });
    void flushAudit();
    return okResponse(created, 201);
  } catch (err) {
    return toResponse(err);
  }
});
