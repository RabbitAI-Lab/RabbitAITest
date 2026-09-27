import { withProjectScope, toResponse, okResponse, zodParse } from '@/server/guard';
import { NextResponse } from 'next/server';
import { pointUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/plan/plan-points.service';

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:UPDATE');
    ctx.requireWritable();
    const { planId, pointId } = await (seg as { params: Promise<{ planId: string; pointId: string }> }).params;
    const body = zodParse(pointUpsertSchema.partial(), await req.json());
    return okResponse(await svc.updatePoint(ctx.projectId, planId, pointId, body));
  } catch (err) { return toResponse(err); }
});

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:UPDATE');
    ctx.requireWritable();
    const { planId, pointId } = await (seg as { params: Promise<{ planId: string; pointId: string }> }).params;
    return okResponse(await svc.deletePoint(ctx.projectId, planId, pointId));
  } catch (err) { return toResponse(err); }
});
