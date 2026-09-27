import { NextResponse } from "next/server";
import { ok, scenarioExecuteSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { createScenarioTask } from "@/server/domains/exec/exec.service";
import { expandEnvGroup } from "@/server/domains/project/environment.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json({ code: 20422, message: message ?? "参数校验失败", data: null }, { status: 422 });

/** 批量执行（API-008 §4：1..50 场景；serial/parallel + 失败停止）。
 *  S5 PROJ-006：envGroupId=按组执行（与 envId 互斥）——按组内顺序逐环境各建一个任务。 */
export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:CREATE");
    const parsed = scenarioExecuteSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    const input = parsed.data;
    if (input.envGroupId) {
      if (input.envId) {
        return unprocessable("envId 与 envGroupId 互斥，只能二选一");
      }
      const group = await expandEnvGroup(ctx.projectId, input.envGroupId);
      const tasks: { taskId: string; envId: string; envName: string }[] = [];
      let warnings: string[] = [];
      for (const env of group.environments) {
        const r = await createScenarioTask(ctx.projectId, ctx.userId, {
          scenarioIds: input.scenarioIds,
          envId: env.id,
          poolId: input.poolId,
          stopOnFail: input.stopOnFail,
          mode: input.mode,
        });
        tasks.push({ taskId: r.taskId, envId: env.id, envName: env.name });
        warnings = r.warnings;
      }
      return NextResponse.json(ok({ tasks, warnings }), { status: 201 });
    }
    return NextResponse.json(
      ok(
        await createScenarioTask(ctx.projectId, ctx.userId, {
          scenarioIds: input.scenarioIds,
          envId: input.envId,
          poolId: input.poolId,
          stopOnFail: input.stopOnFail,
          mode: input.mode,
        }),
      ),
      { status: 201 },
    );
  } catch (err) {
    return toResponse(err);
  }
});
