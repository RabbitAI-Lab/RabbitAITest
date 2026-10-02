import { NextResponse } from "next/server";
import { logFor } from "@rabbit/shared/logger";
import { rateLimit } from "@/server/rate-limit";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { exchangeDeviceToken, refreshGrant, sha256Hex } from "@/server/domains/api/oauth.service";

export const runtime = "nodejs";

/**
 * SYS-009：token 端点（RFC 8628 §3.4/3.5）——**RFC 原生 JSON/错误，不走平台信封**。
 * form-encoded：grant_type=device_code（轮询）/ refresh_token（旋转）。
 * 轮询限速按 device_code 哈希键控（>13/min → 429 slow_down，CLI 自动退避）。
 */
export async function POST(req: Request) {
  try {
    // RFC 8628 端点为 form-encoded；显式 URLSearchParams 解析（req.formData() 对
    // grant_type=urn:ietf:params:oauth:grant-type:device_code 这类冒号密集值解析异常）
    const form = new URLSearchParams(await req.text());
    const grantType = form.get("grant_type") ?? "";
    const clientId = form.get("client_id") ?? "";

    if (grantType === "urn:ietf:params:oauth:grant-type:device_code") {
      const deviceCode = form.get("device_code") ?? "";
      if (!deviceCode) {
        return NextResponse.json({ error: "invalid_request" }, { status: 400 });
      }
      const rl = await rateLimit("oauth-token", sha256Hex(deviceCode).slice(0, 16), 13, 60);
      if (!rl.allowed) {
        return NextResponse.json({ error: "slow_down" }, { status: 429 });
      }
      const res = await exchangeDeviceToken(deviceCode);
      if (res.kind === "pending") {
        return NextResponse.json({ error: "authorization_pending" }, { status: 400 });
      }
      if (res.kind === "denied") {
        return NextResponse.json({ error: "access_denied" }, { status: 400 });
      }
      if (res.kind === "expired") {
        return NextResponse.json({ error: "expired_token" }, { status: 400 });
      }
      recordAudit({
        userId: res.userId,
        scope: "system",
        action: "oauth.token.issue",
        objectType: "oauth_grant",
        detail: { clientId, scope: res.scope },
      });
      void flushAudit();
      return NextResponse.json({
        access_token: res.access_token,
        refresh_token: res.refresh_token,
        token_type: "Bearer",
        expires_in: res.expires_in,
        scope: res.scope,
      });
    }

    if (grantType === "refresh_token") {
      const refreshToken = form.get("refresh_token") ?? "";
      if (!refreshToken) {
        return NextResponse.json({ error: "invalid_request" }, { status: 400 });
      }
      const rl = await rateLimit("oauth-refresh", sha256Hex(refreshToken).slice(0, 16), 10, 60);
      if (!rl.allowed) {
        return NextResponse.json({ error: "slow_down" }, { status: 429 });
      }
      const res = await refreshGrant(refreshToken);
      if (res.kind === "invalid") {
        return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
      }
      recordAudit({
        userId: res.userId,
        scope: "system",
        action: "oauth.token.refresh",
        objectType: "oauth_grant",
        objectId: res.grantId,
        detail: { clientId, scope: res.scope },
      });
      void flushAudit();
      return NextResponse.json({
        access_token: res.access_token,
        refresh_token: res.refresh_token,
        token_type: "Bearer",
        expires_in: res.expires_in,
        scope: res.scope,
      });
    }

    return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 });
  } catch (err) {
    logFor("http").error({ err }, "oauth token failed");
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
}
