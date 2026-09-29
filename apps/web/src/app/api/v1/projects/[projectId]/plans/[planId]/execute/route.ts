import { withProjectScope, toResponse, okResponse, zodParse } from "@/server/guard";
import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { planExecuteSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/plan/plan-exec.service";
import { expandEnvGroup } from "@/server/domains/project/environment.service";

/** S4 PLAN-003：计划引擎执行（api_case/scenario 真实调度；契约 v4 plan 命令）。
 *  S5 PROJ-006：envGroupId=按组执行（与 envId 互斥）——按组内顺序逐环境各建一个计划任务。 */
export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_PLAN:UPDATE");
    ctx.requireWritable();
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    const body = zodParse(planExecuteSchema, await req.json());
    if (body.envGroupId) {
      if (body.envId) {
        return NextResponse.json(
          { code: 20422, message: "envId 与 envGroupId 互斥，只能二选一", data: null },
          { status: 422 },
        );
      }
      const group = await expandEnvGroup(ctx.projectId, body.envGroupId);
      const tasks: { taskId: string; envId: string; envName: string }[] = [];
      for (const env of group.environments) {
        const r = await svc.createPlanTask(ctx.projectId, planId, ctx.userId, {
          ...body,
          envId: env.id,
        });
        tasks.push({ taskId: r.taskId, envId: env.id, envName: env.name });
      }
      return NextResponse.json(ok({ tasks }), { status: 201 });
    }
    return NextResponse.json(
      ok(await svc.createPlanTask(ctx.projectId, planId, ctx.userId, body)),
      { status: 201 },
    );
  } catch (err) {
    return toResponse(err);
  }
});
