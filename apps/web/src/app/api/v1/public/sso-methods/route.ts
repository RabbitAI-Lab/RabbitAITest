import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { listSsoMethods } from "@/server/domains/entp/sso.service";
import { entpFeatureActive } from "@/server/domains/entp/license.service";

export const runtime = "nodejs";

/**
 * 登录页「更多登录方式」（public，无鉴权；只暴露 {authId,type,name}，不含配置与密钥）。
 * 社区版/SSO 特性未授权 → 空数组（登录页不渲染该区块）。
 */
export async function GET(): Promise<NextResponse> {
  const items = (await entpFeatureActive("SSO")) ? await listSsoMethods().catch(() => []) : [];
  return NextResponse.json(ok(items), { headers: { "Cache-Control": "no-store" } });
}
