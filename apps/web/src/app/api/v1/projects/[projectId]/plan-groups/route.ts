import { withProjectScope, toResponse, okResponse, zodParse } from '@/server/guard';
import { NextResponse } from 'next/server';
import { ok } from '@rabbit/shared';
import { planGroupUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/plan/plan-group.service';

/** S4 PLAN-004：计划组列表（组视图聚合+成员嵌套+未分组）。 */
export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:READ');
    const url = new URL(req.url);
    const archived = url.searchParams.get('archived') === 'only';
    return okResponse(await svc.listPlanGroups(ctx.projectId, archived));
  } catch (err) { return toResponse(err); }
});

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:CREATE');
    ctx.requireWritable();
    const body = zodParse(planGroupUpsertSchema, await req.json());
    return NextResponse.json(ok(await svc.createPlanGroup(ctx.projectId, ctx.userId, body)), { status: 201 });
  } catch (err) { return toResponse(err); }
});
