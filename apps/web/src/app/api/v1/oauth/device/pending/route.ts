import { NextResponse } from "next/server";
import { toResponse, withAuth } from "@/server/guard";
import { normalizeUserCode } from "@rabbit/shared";
import { lookupPendingByUserCode } from "@/server/domains/api/oauth.service";

export const runtime = "nodejs";

/** SYS-009：确认页「校验」步——PENDING 待授权请求回显（session；无效码 404 防枚举）。 */
export const GET = withAuth(async (ctx, req: Request) => {
  try {
    const code = new URL(req.url).searchParams.get("code") ?? "";
    const normalized = normalizeUserCode(code);
    if (normalized.length !== 8) {
      return NextResponse.json(
        { code: 10030, message: "设备代码格式非法", data: null },
        { status: 422 },
      );
    }
    const pending = await lookupPendingByUserCode(code);
    if (!pending) {
      // 防枚举：不区分「不存在/已批准/已过期」
      return NextResponse.json(
        { code: 10030, message: "设备代码无效或已过期", data: null },
        { status: 422 },
      );
    }
    return NextResponse.json({ code: 0, message: "ok", data: pending });
  } catch (err) {
    return toResponse(err);
  }
});
