import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { getLicenseState } from "@/server/domains/entp/license.service";

export const runtime = "nodejs";

/**
 * 公开授权状态（ENTP-007）：前端按钮解锁/锁定驱动（无鉴权，不泄 payload 与 code）。
 * no-store：License 增删即时生效（S5 表单回填假绿教训——禁止中间层缓存）。
 */
export async function GET(): Promise<NextResponse> {
  const state = await getLicenseState().catch(() => null);

  return NextResponse.json(
    ok(
      state ?? {
        edition: "COMMUNITY" as const,
        expiresAt: null,
        features: [],
        daysLeft: null,
        lic: null,
        maxUsers: null,
        featureGateEnabled: false, // 兜底口径与开源默认一致（ENTP-009）
      },
    ),
    { headers: { "Cache-Control": "no-store" } },
  );
}
