import { okResponse, toResponse, withProjectScope, zodParse } from "@/server/guard";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { envGroupUpsertSchema } from "@rabbit/shared";
import * as envSvc from "@/server/domains/project/environment.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ groupId: string }> };

/** PROJ-006：环境组编辑/删除（物理删，无回收站——表无软删列）。 */
export const PATCH = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_ENV:UPDATE");
    ctx.requireWritable();
    const { groupId } = await (seg as Seg).params;
    const body = zodParse(envGroupUpsertSchema, await req.json());
    const updated = await envSvc.updateEnvGroup(ctx.projectId, groupId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "env_group.update",
      objectType: "env_group",
      objectId: groupId,
      detail: { name: updated.name },
    });
    void flushAudit();
    return okResponse(updated);
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_ENV:DELETE");
    ctx.requireWritable();
    const { groupId } = await (seg as Seg).params;
    await envSvc.deleteEnvGroup(ctx.projectId, groupId);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "env_group.delete",
      objectType: "env_group",
      objectId: groupId,
    });
    void flushAudit();
    return okResponse({ id: groupId });
  } catch (err) {
    return toResponse(err);
  }
});
