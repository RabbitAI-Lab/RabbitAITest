import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import * as svc from '@/server/domains/plan/plan-report.service';

/** S4 PLAN-005：计划报告完整视图（概览六卡+测试点维度明细+总结）。 */
export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:READ');
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    return okResponse(await svc.buildPlanReportView(ctx.projectId, planId));
  } catch (err) { return toResponse(err); }
});

/** 手动刷新（重算视图；执行完成自动刷新在回调链路）。 */
export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:READ');
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    return okResponse(await svc.buildPlanReportView(ctx.projectId, planId));
  } catch (err) { return toResponse(err); }
});
