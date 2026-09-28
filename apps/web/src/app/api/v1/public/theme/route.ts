import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { publicTheme } from "@/server/domains/system/param.service";

export const runtime = "nodejs";

/**
 * 公开主题（ENTP-004）：登录页/控制台品牌消费（无鉴权；未配置=默认值）。
 * no-store：保存并应用即时生效。
 */
export async function GET(): Promise<NextResponse> {
  const theme = await publicTheme().catch(() => null);
  return NextResponse.json(ok(theme ?? {}), { headers: { "Cache-Control": "no-store" } });
}
