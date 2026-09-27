import { NextResponse } from "next/server";
import { toResponse, okResponse, withOrgScope } from "@/server/guard";
import { integrationSaveSchema, PLATFORMS } from "@rabbit/shared";
import * as svc from "@/server/domains/api/integration.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

/** INTG-001/002：组织服务集成列表（三平台全量形态，未配置=NONE）。凭据永不回显。 */
export const GET = withOrgScope(async (ctx, _req) => {
  try {
    ctx.requirePerm("ORG_INTEGRATION:READ");
    return okResponse(await svc.listIntegrations(ctx.orgId));
  } catch (err) {
    return toResponse(err);
  }
});

/** INTG-001/002：保存集成（凭据 AES-GCM 加密落库）。 */
export const PUT = withOrgScope(async (ctx, req) => {
  try {
    ctx.requirePerm("ORG_INTEGRATION:UPDATE");
    const body = integrationSaveSchema.parse(await req.json());
    await svc.saveIntegration(ctx.orgId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "org",
      action: "integration.save",
      objectType: "platform_integration",
      objectId: body.platform,
      detail: { platform: body.platform, authType: body.authType },
    });
    void flushAudit();
    return okResponse({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
});

/** INTG-001/002：删除集成（无项目关联时）。 */
export const DELETE = withOrgScope(async (ctx, req) => {
  try {
    ctx.requirePerm("ORG_INTEGRATION:UPDATE");
    const platform = new URL(req.url).searchParams.get("platform") ?? "";
    if (!(PLATFORMS as readonly string[]).includes(platform)) {
      return NextResponse.json({ code: 70012, message: "platform 非法", data: null }, { status: 422 });
    }
    await svc.deleteIntegration(ctx.orgId, platform);
    recordAudit({
      userId: ctx.userId,
      scope: "org",
      action: "integration.delete",
      objectType: "platform_integration",
      objectId: platform,
    });
    void flushAudit();
    return okResponse({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
});
