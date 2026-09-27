import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import { NextResponse } from 'next/server';
import { ok } from '@rabbit/shared';
import * as svc from '@/server/domains/plan/plan-exec.service';

/** S4 PLAN-003：单条引擎执行（api_case/scenario；构造单项 plan 任务，报告链路一致）。 */
export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:UPDATE');
    ctx.requireWritable();
    const { planId, refId } = await (seg as { params: Promise<{ planId: string; refId: string }> }).params;
    return NextResponse.json(ok(await svc.runPlanCaseRef(ctx.projectId, planId, refId, ctx.userId)), { status: 201 });
  } catch (err) { return toResponse(err); }
});
