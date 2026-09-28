import { okResponse, toResponse, withProjectScope } from "@/server/guard";
import * as repoSvc from "@/server/domains/project/file-repo.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ fileId: string }> };

/** S5 FILE-001：仓库文件重新拉取（sync 单文件，内容与 size 刷新）。 */
export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_FILE:UPDATE");
    ctx.requireWritable();
    const { fileId } = await (seg as Seg).params;
    return okResponse(await repoSvc.syncRepoFile(ctx.projectId, fileId));
  } catch (err) {
    return toResponse(err);
  }
});
