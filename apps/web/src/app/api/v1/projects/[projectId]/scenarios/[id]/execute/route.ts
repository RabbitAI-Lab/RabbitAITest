import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { createScenarioTask } from "@/server/domains/exec/exec.service";

export const runtime = "nodejs";

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:CREATE");
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const body = (await req.json().catch(() => ({}))) as { envId?: string; poolId?: string };
    return NextResponse.json(
      ok(
        await createScenarioTask(ctx.projectId, ctx.userId, {
          scenarioIds: [id],
          envId: body.envId,
          poolId: body.poolId,
          stopOnFail: false,
          mode: "serial",
        }),
      ),
      { status: 201 },
    );
  } catch (err) {
    return toResponse(err);
  }
});
