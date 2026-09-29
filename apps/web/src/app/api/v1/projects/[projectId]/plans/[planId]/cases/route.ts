import { withProjectScope, toResponse, okResponse, zodParse } from "@/server/guard";
import { planCasesAddV2Schema } from "@rabbit/shared";
import * as svc from "@/server/domains/plan/plan.service";

/** PLAN-001 关联用例；S4 PLAN-002 升级：+scenarioIds（场景关联）+pointId（挂点）。 */
export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_PLAN:UPDATE");
    ctx.requireWritable();
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    const body = zodParse(planCasesAddV2Schema, await req.json());
    return okResponse(
      await svc.addPlanCases(
        ctx.projectId,
        planId,
        body.caseIds,
        body.execUserId,
        body.apiCaseIds,
        body.scenarioIds,
        body.pointId ?? null,
      ),
    );
  } catch (err) {
    return toResponse(err);
  }
});
