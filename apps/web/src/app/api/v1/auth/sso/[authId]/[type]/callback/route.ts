import { NextResponse } from "next/server";
import { toResponse } from "@/server/guard";
import { getSession } from "@/lib/session";
import { entpFeatureActive } from "@/server/domains/entp/license.service";
import {
  consumeState,
  requireEnabledSource,
  exchangeOidc,
  exchangeCas,
  exchangeWecom,
  exchangeDingtalk,
  exchangeFeishu,
  findOrCreateSsoUser,
} from "@/server/domains/entp/sso-flow.service";
import { audit } from "@/server/domains/system/auth.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ authId: string; type: string }> };

const CALLBACK_TYPES = new Set(["oidc", "oauth2", "cas", "wecom", "dingtalk", "feishu"]);
const SOURCE_TYPE_BY_CALLBACK: Record<string, string> = {
  oidc: "OIDC",
  oauth2: "OAUTH2",
  cas: "CAS",
  wecom: "WECOM",
  dingtalk: "DINGTALK",
  feishu: "FEISHU",
};

/**
 * SSO/扫码回调（未登录可达）：state 校验 → code/ticket 换身份 → find-or-create → 会话 → 302 首页。
 * 失败态返回 JSON（登录页/中转页按 code 文案提示），不泄 IdP 原始响应。
 */
export async function GET(req: Request, seg: Seg): Promise<NextResponse> {
  try {
    const { authId, type } = await seg.params;
    if (!(await entpFeatureActive("SSO"))) {
      return NextResponse.redirect(new URL("/login?sso=disabled", req.url), 302);
    }
    if (!CALLBACK_TYPES.has(type)) {
      return NextResponse.redirect(new URL("/login?sso=badtype", req.url), 302);
    }
    const url = new URL(req.url);
    const state = url.searchParams.get("state");
    const consumedAuthId = await consumeState(state);
    if (consumedAuthId !== authId) {
      return NextResponse.redirect(new URL("/login?sso=state", req.url), 302);
    }
    const src = await requireEnabledSource(authId);
    if (src.type !== SOURCE_TYPE_BY_CALLBACK[type]) {
      return NextResponse.redirect(new URL("/login?sso=badtype", req.url), 302);
    }

    const identity =
      type === "oidc" || type === "oauth2"
        ? await exchangeOidc(src, url.searchParams.get("code") ?? "", url.origin)
        : type === "cas"
          ? await exchangeCas(
              src,
              url.searchParams.get("ticket") ?? "",
              `${url.origin}/api/v1/auth/sso/cas/${authId}/callback`,
            )
          : type === "wecom"
            ? await exchangeWecom(src, url.searchParams.get("code") ?? "")
            : type === "dingtalk"
              ? await exchangeDingtalk(src, url.searchParams.get("authCode") ?? "")
              : await exchangeFeishu(src, url.searchParams.get("code") ?? "");

    const user = await findOrCreateSsoUser(identity, src.type);
    const session = await getSession();
    session.userId = user.userId;
    session.email = user.email;
    await session.save();
    void audit(user.userId, "sso.login", "user", user.userId).catch(() => {});
    return NextResponse.redirect(new URL("/", req.url), 302);
  } catch (err) {
    // 换身份失败：回登录页带错误标记（文案由登录页按 ?sso= 呈现；详细原因在服务端日志）
    void audit(null, "sso.login_failed", "auth_source").catch(() => {});
    return toResponse(err);
  }
}
