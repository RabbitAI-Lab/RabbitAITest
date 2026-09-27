import { NextResponse } from "next/server";
import { toResponse, okResponse } from "@/server/guard";
import { openExecScenarioSchema } from "@rabbit/shared";
import { withApiKey, assertProjectVisible } from "@/server/open-api-guard";
import { createScenarioTask } from "@/server/domains/exec/exec.service";
import { prisma } from "@rabbit/db";

export const runtime = "nodejs";

/** INTG-003：CI 触发场景执行（open）。 */
export const POST = withApiKey(async (ctx, req) => {
  try {
    const body = openExecScenarioSchema.parse(await req.json());
    const scenario = await prisma.scenario.findFirst({
      where: { id: body.scenarioId, deletedAt: null },
      select: { projectId: true },
    });
    if (!scenario) return NextResponse.json({ code: 40474, message: "场景不存在", data: null }, { status: 404 });
    await assertProjectVisible(ctx.userId, scenario.projectId);
    const { taskId } = await createScenarioTask(scenario.projectId, ctx.userId, {
      scenarioIds: [body.scenarioId],
      envId: body.envId ?? undefined,
      poolId: body.resourcePoolId ?? undefined,
      stopOnFail: false,
      mode: "serial",
    });
    return okResponse({ taskId }, 201);
  } catch (err) {
    return toResponse(err);
  }
});
