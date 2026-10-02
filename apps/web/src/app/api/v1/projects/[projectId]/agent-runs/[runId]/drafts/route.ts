/** AGENT-002：草稿列表（分组信封+冲突标注+采纳率统计）。 */
import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import { listDrafts } from "@/server/domains/agent/pipeline/drafts.service";

type Seg = { params: Promise<{ runId: string }> };

export const GET = withProjectScope(async (ctx, req, segArg) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:READ");
    const { runId } = await (segArg as Seg).params;
    const url = new URL(req.url);
    const assetType = url.searchParams.get("assetType") ?? undefined;
    return okResponse(await listDrafts(ctx.projectId, runId, assetType ?? undefined));
  } catch (err) {
    return toResponse(err);
  }
});
