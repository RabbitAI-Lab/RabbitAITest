import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import * as svc from "@/server/domains/api/platform-sync.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

/** INTG-001/002：单条缺陷推送（本地 → 平台；已同步走更新分支）。 */
export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_BUG:UPDATE");
    ctx.requireWritable();
    const { bugId } = await (seg as { params: Promise<{ bugId: string }> }).params;
    const ref = await svc.pushBug(ctx.projectId, ctx.orgId, bugId);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "integration.sync",
      objectType: "bug",
      objectId: bugId,
      detail: { direction: "push", platformKey: ref.platformKey },
    });
    void flushAudit();
    return okResponse(ref);
  } catch (err) {
    return toResponse(err);
  }
});
