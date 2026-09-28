import { okResponse, toResponse, withProjectScope, zodParse } from "@/server/guard";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { envGroupUpsertSchema } from "@rabbit/shared";
import * as envSvc from "@/server/domains/project/environment.service";

export const runtime = "nodejs";

/** PROJ-006：环境组列表/新建（PROJECT_ENV 点复用；组=有序环境集 ≤10，上限 20 组）。 */
export const GET = withProjectScope(async (ctx) => {
  try {
    ctx.requirePerm("PROJECT_ENV:READ");
    return okResponse(await envSvc.listEnvGroups(ctx.projectId));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_ENV:CREATE");
    ctx.requireWritable();
    const body = zodParse(envGroupUpsertSchema, await req.json());
    const created = await envSvc.createEnvGroup(ctx.projectId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "env_group.create",
      objectType: "env_group",
      objectId: created.id,
      detail: { name: created.name, environments: created.environmentIds.length },
    });
    void flushAudit();
    return okResponse(created, 201);
  } catch (err) {
    return toResponse(err);
  }
});
