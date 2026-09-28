import { NextResponse } from "next/server";
import { ErrCode, ErrMsg } from "@rabbit/shared";
import { toResponse } from "@/server/guard";
import { entpFeatureActive } from "@/server/domains/entp/license.service";
import { buildAuthorizeUrl } from "@/server/domains/entp/sso-flow.service";
import { audit } from "@/server/domains/system/auth.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ authId: string }> };

/**
 * 发起 SSO/扫码登录（未登录可达——middleware 仅对页面重定向，API 直通）。
 * 302 到 IdP/平台扫码授权页；state 已入 Redis（5 分钟）。
 */
export async function GET(req: Request, seg: Seg): Promise<NextResponse> {
  try {
    const { authId } = await seg.params;
    const origin = new URL(req.url).origin;
    if (!(await entpFeatureActive("SSO"))) {
      return NextResponse.json(
        { code: ErrCode.LICENSE_REQUIRED, message: ErrMsg[ErrCode.LICENSE_REQUIRED]!, data: null },
        { status: 403 },
      );
    }
    const { url } = await buildAuthorizeUrl(authId, origin);
    return NextResponse.redirect(url, 302);
  } catch (err) {
    void audit(null, "sso.authorize_failed", "auth_source").catch(() => {});
    return toResponse(err);
  }
}
