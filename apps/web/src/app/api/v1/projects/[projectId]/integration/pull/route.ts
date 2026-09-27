import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import * as svc from "@/server/domains/api/platform-sync.service";

export const runtime = "nodejs";

/** INTG-001/002：手动拉取（平台状态 → 本地回写；手动/定时同路径）。 */
export const POST = withProjectScope(async (ctx) => {
  try {
    ctx.requirePerm("PROJECT_BUG:UPDATE");
    ctx.requireWritable();
    const result = await svc.pullBugs(ctx.projectId, ctx.orgId, "manual");
    return okResponse(result);
  } catch (err) {
    return toResponse(err);
  }
});
