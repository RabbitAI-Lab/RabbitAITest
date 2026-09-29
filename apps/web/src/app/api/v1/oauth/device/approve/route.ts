import { toResponse, okResponse, withAuth, zodParse } from "@/server/guard";
import { DomainError, ErrCode, oauthApproveSchema, normalizeUserCode } from "@rabbit/shared";
import { rateLimit, rateCount } from "@/server/rate-limit";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import {
  MAX_APPROVE_FAILS,
  approveDeviceCode,
  lookupPendingByUserCode,
} from "@/server/domains/api/oauth.service";

export const runtime = "nodejs";

/**
 * SYS-009：批准/拒绝（session 本人，平台信封）。错码锁定：失败 ≥5 次/10 分钟（用户维度）→ 422 10030。
 */
export const POST = withAuth(async (ctx, req: Request) => {
  try {
    const body = zodParse(oauthApproveSchema, await req.json());
    const fails = await rateCount("oauth-approve-fail", ctx.userId, 600);
    if (fails >= MAX_APPROVE_FAILS) {
      throw new DomainError(ErrCode.OAUTH_USER_CODE_INVALID, "尝试次数过多，请 10 分钟后重试");
    }
    const pending = await lookupPendingByUserCode(body.userCode);
    try {
      await approveDeviceCode(body.userCode, ctx.userId, body.approve);
    } catch (err) {
      if (err instanceof DomainError && err.code === ErrCode.OAUTH_USER_CODE_INVALID) {
        await rateLimit("oauth-approve-fail", ctx.userId, MAX_APPROVE_FAILS, 600);
      }
      throw err;
    }
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: body.approve ? "oauth.code.approve" : "oauth.code.deny",
      objectType: "oauth_device_code",
      objectId: normalizeUserCode(body.userCode),
      detail: { scope: pending?.scope?.join(","), clientId: pending?.clientId },
    });
    void flushAudit();
    return okResponse({ approved: body.approve });
  } catch (err) {
    return toResponse(err);
  }
});
