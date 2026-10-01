/** SCM-001：组织级 OAuth App 覆盖（PUT 保存/DELETE 撤销回落继承系统级）。 */
import { toResponse, okResponse, withOrgScope, zodParse } from "@/server/guard";
import { scmOauthProviderSchema, scmOrgAppUpsertSchema } from "@rabbit/shared";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import * as svc from "@/server/domains/scm/scm-app.service";

type Seg = { params: Promise<{ provider: string }> };

export const PUT = withOrgScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("ORG_INTEGRATION:UPDATE");
    const { provider } = await (seg as Seg).params;
    const parsedProvider = zodParse(scmOauthProviderSchema, provider);
    const body = zodParse(scmOrgAppUpsertSchema, await req.json());
    const saved = await svc.upsertScmOrgApp(ctx.orgId, parsedProvider, body);
    recordAudit({
      userId: ctx.userId,
      scope: "org",
      action: "scm_org_app.upsert",
      objectType: "scm_org_app",
      objectId: parsedProvider,
      detail: { provider: parsedProvider, hasSecret: saved.hasSecret },
    });
    void flushAudit();
    return okResponse(saved);
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withOrgScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("ORG_INTEGRATION:UPDATE");
    const { provider } = await (seg as Seg).params;
    const parsedProvider = zodParse(scmOauthProviderSchema, provider);
    await svc.deleteScmOrgApp(ctx.orgId, parsedProvider);
    recordAudit({
      userId: ctx.userId,
      scope: "org",
      action: "scm_org_app.delete",
      objectType: "scm_org_app",
      objectId: parsedProvider,
    });
    void flushAudit();
    return okResponse({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
});
