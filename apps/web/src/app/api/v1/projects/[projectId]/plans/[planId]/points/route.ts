import { withProjectScope, toResponse, okResponse, zodParse } from '@/server/guard';
import { pointUpsertSchema, ok } from '@rabbit/shared';
import { NextResponse } from 'next/server';
import * as svc from '@/server/domains/plan/plan-points.service';

/** S4 PLAN-002：测试点树（含每点三类挂载数与未分组统计）。 */
export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:READ');
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    return okResponse(await svc.listPoints(ctx.projectId, planId));
  } catch (err) { return toResponse(err); }
});

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:UPDATE');
    ctx.requireWritable();
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    const body = zodParse(pointUpsertSchema, await req.json());
    return NextResponse.json(ok(await svc.createPoint(ctx.projectId, planId, body)), { status: 201 });
  } catch (err) { return toResponse(err); }
});
