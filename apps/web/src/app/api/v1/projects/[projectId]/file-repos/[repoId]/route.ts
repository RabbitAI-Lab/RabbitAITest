import { okResponse, toResponse, withProjectScope, zodParse } from "@/server/guard";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { fileRepoUpsertSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/project/file-repo.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ repoId: string }> };

/** FILE-001：存储库编辑（token 留空=不更新）/删除（物理删；文件保留溯源）。 */
export const PATCH = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_FILE:UPDATE");
    ctx.requireWritable();
    const { repoId } = await (seg as Seg).params;
    const body = zodParse(fileRepoUpsertSchema, await req.json());
    const updated = await svc.updateFileRepo(ctx.projectId, repoId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "file_repo.update",
      objectType: "file_repo",
      objectId: repoId,
      detail: { platform: updated.platform },
    });
    void flushAudit();
    return okResponse(updated);
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_FILE:DELETE");
    ctx.requireWritable();
    const { repoId } = await (seg as Seg).params;
    await svc.deleteFileRepo(ctx.projectId, repoId);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "file_repo.delete",
      objectType: "file_repo",
      objectId: repoId,
    });
    void flushAudit();
    return okResponse({ id: repoId });
  } catch (err) {
    return toResponse(err);
  }
});
