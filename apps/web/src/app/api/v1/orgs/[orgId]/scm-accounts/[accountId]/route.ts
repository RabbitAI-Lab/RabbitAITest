/** SCM-001：撤销授权账号（授权人本人或 ORG_INTEGRATION:UPDATE）。 */
import { toResponse, okResponse, withOrgScope } from "@/server/guard";
import { revokeScmAccount } from "@/server/domains/scm/scm-oauth.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

type Seg = { params: Promise<{ accountId: string }> };

export const DELETE = withOrgScope(async (ctx, _req, seg) => {
  try {
    const { accountId } = await (seg as Seg).params;
    const canOverride = ctx.permissions.has("ORG_INTEGRATION:UPDATE");
    const r = await revokeScmAccount(ctx.orgId, accountId, ctx.userId, canOverride);
    recordAudit({
      userId: ctx.userId,
      scope: "org",
      action: "scm_account.revoke",
      objectType: "scm_account",
      objectId: accountId,
    });
    void flushAudit();
    return okResponse(r);
  } catch (err) {
    return toResponse(err);
  }
});
