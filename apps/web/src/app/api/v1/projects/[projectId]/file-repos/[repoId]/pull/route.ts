import { okResponse, toResponse, withProjectScope, zodParse } from "@/server/guard";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { fileRepoPullSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/project/file-repo.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ repoId: string }> };

/** FILE-001：按分支+路径拉取（目录递归≤3、文件≤50；重复拉取=覆盖更新）。 */
export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_FILE:CREATE");
    ctx.requireWritable();
    const { repoId } = await (seg as Seg).params;
    const body = zodParse(fileRepoPullSchema, await req.json());
    const r = await svc.pullFileRepo(ctx.projectId, repoId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "file_repo.pull",
      objectType: "file_repo",
      objectId: repoId,
      detail: { branch: body.branch, path: body.path, ...r },
    });
    void flushAudit();
    return okResponse(r, 201);
  } catch (err) {
    return toResponse(err);
  }
});
