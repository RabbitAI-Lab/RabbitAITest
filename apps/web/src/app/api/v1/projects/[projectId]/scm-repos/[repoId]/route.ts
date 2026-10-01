/** SCM-001：绑定 编辑（改名/换认证/设默认）/ 软删。 */
import { toResponse, okResponse, withProjectScope, zodParse } from "@/server/guard";
import { scmRepoUpdateSchema } from "@rabbit/shared";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import * as svc from "@/server/domains/scm/scm-repo.service";

type Seg = { params: Promise<{ repoId: string }> };

export const PATCH = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_REPO:UPDATE");
    ctx.requireWritable();
    const { repoId } = await (seg as Seg).params;
    const body = zodParse(scmRepoUpdateSchema, await req.json());
    const updated = await svc.updateScmRepo(ctx.projectId, repoId, body);
    if (body.isDefault) {
      recordAudit({
        userId: ctx.userId,
        scope: "project",
        projectId: ctx.projectId,
        action: "scm_repo.set_default",
        objectType: "scm_repository",
        objectId: repoId,
      });
    }
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "scm_repo.update",
      objectType: "scm_repository",
      objectId: repoId,
      detail: { authTypeChanged: body.authType !== undefined },
    });
    void flushAudit();
    return okResponse(updated);
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_REPO:DELETE");
    ctx.requireWritable();
    const { repoId } = await (seg as Seg).params;
    const r = await svc.deleteScmRepo(ctx.projectId, repoId);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "scm_repo.delete",
      objectType: "scm_repository",
      objectId: repoId,
    });
    void flushAudit();
    return okResponse(r);
  } catch (err) {
    return toResponse(err);
  }
});
