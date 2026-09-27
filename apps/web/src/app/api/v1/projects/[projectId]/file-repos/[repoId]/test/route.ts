import { okResponse, toResponse, withProjectScope } from "@/server/guard";
import * as svc from "@/server/domains/project/file-repo.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ repoId: string }> };

/** FILE-001：连接测试（repo 元信息探活；凭据失效 422 回显）。 */
export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_FILE:UPDATE");
    const { repoId } = await (seg as Seg).params;
    return okResponse(await svc.testFileRepo(ctx.projectId, repoId));
  } catch (err) {
    return toResponse(err);
  }
});
