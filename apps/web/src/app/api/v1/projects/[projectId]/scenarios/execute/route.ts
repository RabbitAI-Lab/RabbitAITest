import { NextResponse } from "next/server";
import { ok, scenarioExecuteSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { createScenarioTask } from "@/server/domains/exec/exec.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json({ code: 20422, message: message ?? "参数校验失败", data: null }, { status: 422 });

/** 批量执行（API-008 §4：1..50 场景；serial/parallel + 失败停止）。 */
export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:CREATE");
    const parsed = scenarioExecuteSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(
      ok(
        await createScenarioTask(ctx.projectId, ctx.userId, {
          scenarioIds: parsed.data.scenarioIds,
          envId: parsed.data.envId,
          poolId: parsed.data.poolId,
          stopOnFail: parsed.data.stopOnFail,
          mode: parsed.data.mode,
        }),
      ),
      { status: 201 },
    );
  } catch (err) {
    return toResponse(err);
  }
});
