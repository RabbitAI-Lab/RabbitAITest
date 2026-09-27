import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { toResponse } from "@/server/guard";
import { planShareDetail } from "@/server/domains/plan/plan-report.service";

export const runtime = "nodejs";

/** S4 PLAN-005：计划报告免登录分享读（token 即凭证；60414 → 404 由 toResponse 统一处理）。 */
export const GET = async (
  _req: Request,
  seg: { params: Promise<{ token: string }> },
): Promise<NextResponse> => {
  try {
    const { token } = await seg.params;
    return NextResponse.json(ok(await planShareDetail(token)));
  } catch (err) {
    return toResponse(err);
  }
};
