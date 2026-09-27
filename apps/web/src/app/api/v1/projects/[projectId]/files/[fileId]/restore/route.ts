import { okResponse, toResponse, withProjectScope } from "@/server/guard";
import * as svc from "@/server/domains/project/file.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ fileId: string }> };

/** S5 FILE-001：文件回收站恢复（PROJ-004 登记兑现）。 */
export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_FILE:UPDATE");
    ctx.requireWritable();
    const { fileId } = await (seg as Seg).params;
    return okResponse(await svc.restoreFile(ctx.projectId, fileId));
  } catch (err) {
    return toResponse(err);
  }
});
