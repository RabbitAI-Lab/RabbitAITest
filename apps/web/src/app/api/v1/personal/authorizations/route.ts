import { toResponse, okResponse, withAuth } from "@/server/guard";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { listGrants, revokeGrant } from "@/server/domains/api/oauth.service";

export const runtime = "nodejs";

/** SYS-009：授权会话列表（本人，session）。 */
export const GET = withAuth(async (ctx) => {
  try {
    return okResponse(await listGrants(ctx.userId));
  } catch (err) {
    return toResponse(err);
  }
});

/** SYS-009：全部吊销（「全部吊销」按钮——应急口径）。 */
export const DELETE = withAuth(async (ctx) => {
  try {
    const grants = await listGrants(ctx.userId);
    for (const g of grants) {
      if (g.status === "ACTIVE") await revokeGrant(ctx.userId, g.id);
    }
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: "oauth.grant.revoke-all",
      objectType: "oauth_grant",
      detail: { count: grants.filter((g) => g.status === "ACTIVE").length },
    });
    void flushAudit();
    return okResponse({ revoked: grants.filter((g) => g.status === "ACTIVE").length });
  } catch (err) {
    return toResponse(err);
  }
});
