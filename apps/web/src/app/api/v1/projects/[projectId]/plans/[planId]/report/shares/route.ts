import { withProjectScope, toResponse, okResponse, zodParse } from "@/server/guard";
import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { shareCreateSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/plan/plan-report.service";

/** S4 PLAN-005：计划报告分享（token 复用 ReportShare；有效期四档沿用 RPT-002）。 */
export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_PLAN:READ");
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    const body = zodParse(shareCreateSchema, await req.json());
    return NextResponse.json(
      ok(await svc.createPlanShare(ctx.projectId, planId, body.expireHours)),
      { status: 201 },
    );
  } catch (err) {
    return toResponse(err);
  }
});

export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_PLAN:READ");
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    return okResponse(await svc.listPlanShares(ctx.projectId, planId));
  } catch (err) {
    return toResponse(err);
  }
});
