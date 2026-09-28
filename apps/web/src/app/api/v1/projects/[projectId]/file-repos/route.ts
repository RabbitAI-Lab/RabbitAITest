import { okResponse, toResponse, withProjectScope, zodParse } from "@/server/guard";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { fileRepoUpsertSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/project/file-repo.service";

export const runtime = "nodejs";

/** FILE-001：存储库列表/连接（gitea|github|gitlab|gitee；token AES-GCM 加密永不回显）。 */
export const GET = withProjectScope(async (ctx) => {
  try {
    ctx.requirePerm("PROJECT_FILE:READ");
    return okResponse(await svc.listFileRepos(ctx.projectId));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_FILE:CREATE");
    ctx.requireWritable();
    const body = zodParse(fileRepoUpsertSchema, await req.json());
    const created = await svc.createFileRepo(ctx.projectId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "file_repo.create",
      objectType: "file_repo",
      objectId: created.id,
      detail: { platform: created.platform, url: created.url },
    });
    void flushAudit();
    return okResponse(created, 201);
  } catch (err) {
    return toResponse(err);
  }
});
