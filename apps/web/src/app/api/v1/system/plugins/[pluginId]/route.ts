import { toResponse, okResponse, withSystemPerm } from "@/server/guard";
import { pluginUpdateSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/api/plugin.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

/** PLUG-001：启停/组织范围。 */
export const PUT = withSystemPerm("SYSTEM_PLUGIN:UPDATE")(async (ctx, req, seg) => {
  try {
    const { pluginId } = await (seg as { params: Promise<{ pluginId: string }> }).params;
    const body = pluginUpdateSchema.parse(await req.json());
    await svc.updatePlugin(pluginId, {
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.orgScope !== undefined ? { orgScope: body.orgScope } : {}),
    });
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: "plugin.update",
      objectType: "plugin",
      objectId: pluginId,
      detail: { enabled: body.enabled, orgScopeChanged: body.orgScope !== undefined },
    });
    void flushAudit();
    return okResponse({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
});

/** PLUG-001：删除（停用态且无引用；70006）。 */
export const DELETE = withSystemPerm("SYSTEM_PLUGIN:UPDATE")(async (ctx, _req, seg) => {
  try {
    const { pluginId } = await (seg as { params: Promise<{ pluginId: string }> }).params;
    await svc.deletePlugin(pluginId);
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: "plugin.delete",
      objectType: "plugin",
      objectId: pluginId,
    });
    void flushAudit();
    return okResponse({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
});
