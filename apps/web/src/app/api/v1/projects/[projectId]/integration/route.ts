import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import { platformSyncSaveSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/api/platform-sync.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

/** INTG-001/002：项目同步关联（GET/PUT；组织未配置平台 → 422 70012）。 */
export const GET = withProjectScope(async (ctx) => {
  try {
    ctx.requirePerm("PROJECT_BUG:READ");
    return okResponse(
      (await svc.getSyncConfig(ctx.projectId)) ?? { enabled: false, platform: null },
    );
  } catch (err) {
    return toResponse(err);
  }
});

export const PUT = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_BUG:UPDATE");
    ctx.requireWritable();
    const body = platformSyncSaveSchema.parse(await req.json());
    await svc.saveSyncConfig(ctx.projectId, ctx.orgId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "integration.config",
      objectType: "platform_sync",
      objectId: body.platform,
      detail: { platform: body.platform, projectKey: body.projectKey, enabled: body.enabled },
    });
    void flushAudit();
    return okResponse({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
});
