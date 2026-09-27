import { NextResponse } from "next/server";
import { ok, scenarioStepsSaveSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { getScenarioDetail, saveSteps } from "@/server/domains/api/scenario.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json({ code: 20422, message: message ?? "参数校验失败", data: null }, { status: 422 });

export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:READ");
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const detail = await getScenarioDetail(ctx.projectId, id);
    return NextResponse.json(ok({ steps: detail.steps, version: detail.version }));
  } catch (err) {
    return toResponse(err);
  }
});

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:UPDATE");
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const parsed = scenarioStepsSaveSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await saveSteps(ctx.projectId, ctx.userId, id, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});
