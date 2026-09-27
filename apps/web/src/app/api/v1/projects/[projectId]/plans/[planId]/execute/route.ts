import { withProjectScope, toResponse, okResponse, zodParse } from '@/server/guard';
import { NextResponse } from 'next/server';
import { ok } from '@rabbit/shared';
import { planExecuteSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/plan/plan-exec.service';

/** S4 PLAN-003：计划引擎执行（api_case/scenario 真实调度；契约 v4 plan 命令）。 */
export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:UPDATE');
    ctx.requireWritable();
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    const body = zodParse(planExecuteSchema, await req.json());
    return NextResponse.json(ok(await svc.createPlanTask(ctx.projectId, planId, ctx.userId, body)), { status: 201 });
  } catch (err) { return toResponse(err); }
});
