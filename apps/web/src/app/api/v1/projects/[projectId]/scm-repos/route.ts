/** SCM-001：项目代码仓库绑定 列表/新增（OAuth 选仓 或 URL 直填两来源）。 */
import { toResponse, okResponse, withProjectScope, zodParse } from "@/server/guard";
import { scmRepoCreateSchema } from "@rabbit/shared";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import * as svc from "@/server/domains/scm/scm-repo.service";

export const GET = withProjectScope(async (ctx) => {
  try {
    ctx.requirePerm("PROJECT_REPO:READ");
    return okResponse(await svc.listScmRepos(ctx.projectId));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_REPO:CREATE");
    ctx.requireWritable();
    const body = zodParse(scmRepoCreateSchema, await req.json());
    const created = await svc.createScmRepo(ctx.orgId, ctx.projectId, ctx.userId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "scm_repo.create",
      objectType: "scm_repository",
      objectId: created.id,
      detail: {
        provider: created.provider,
        authType: created.authType,
        owner: created.owner,
        repo: created.repo,
      },
    });
    void flushAudit();
    return okResponse(created, 201);
  } catch (err) {
    return toResponse(err);
  }
});
