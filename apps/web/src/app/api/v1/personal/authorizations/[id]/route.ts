import { toResponse, okResponse, withAuth } from "@/server/guard";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { revokeGrant } from "@/server/domains/api/oauth.service";

export const runtime = "nodejs";

/** SYS-009：吊销单个授权会话（本人；不存在/越权 404 10031 防枚举）。 */
export const DELETE = withAuth(async (ctx, _req: Request, seg: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await seg.params;
    await revokeGrant(ctx.userId, id);
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: "oauth.grant.revoke",
      objectType: "oauth_grant",
      objectId: id,
    });
    void flushAudit();
    return okResponse({ revoked: true });
  } catch (err) {
    return toResponse(err);
  }
});
