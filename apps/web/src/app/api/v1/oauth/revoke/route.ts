import { toResponse, okResponse, withAuth } from "@/server/guard";
import { DomainError, ErrCode } from "@rabbit/shared";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { revokeByAccessToken } from "@/server/domains/api/oauth.service";

export const runtime = "nodejs";

/**
 * SYS-009：CLI 登出吊销（RFC 7009 形态简化）——Bearer 自身份吊销所属授权会话。
 * 仅 Token 通道（CLI logout 携带 access token best-effort 调用；失败不阻断本地清理）。
 */
export const POST = withAuth(async (ctx, req: Request) => {
  try {
    const authorization = req.headers.get("authorization");
    if (!authorization?.startsWith("Bearer rat_")) {
      throw new DomainError(
        ErrCode.VALIDATION_FAILED,
        "oauth/revoke 需携带 Bearer access token（CLI 登出场景）",
      );
    }
    const revoked = await revokeByAccessToken(authorization.slice("Bearer ".length));
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: "oauth.token.revoke",
      objectType: "oauth_grant",
      detail: { revoked },
    });
    void flushAudit();
    return okResponse({ revoked });
  } catch (err) {
    return toResponse(err);
  }
});
