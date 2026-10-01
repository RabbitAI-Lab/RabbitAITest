/** SCM-001：连通性验证（平台 API 探活 + 元信息刷新：默认分支/可见性/最近提交）。 */
import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import * as svc from "@/server/domains/scm/scm-repo.service";

type Seg = { params: Promise<{ repoId: string }> };

export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_REPO:UPDATE");
    const { repoId } = await (seg as Seg).params;
    const r = await svc.verifyScmRepo(ctx.orgId, ctx.projectId, repoId);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "scm_repo.verify",
      objectType: "scm_repository",
      objectId: repoId,
      detail: { status: r.status },
    });
    void flushAudit();
    return okResponse(r);
  } catch (err) {
    return toResponse(err);
  }
});
