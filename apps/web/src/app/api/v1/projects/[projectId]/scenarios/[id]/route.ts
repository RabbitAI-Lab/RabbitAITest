import { NextResponse } from "next/server";
import { ok, scenarioSaveSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { getScenarioDetail, updateScenario, deleteScenario } from "@/server/domains/api/scenario.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json({ code: 20422, message: message ?? "参数校验失败", data: null }, { status: 422 });

export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:READ");
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return NextResponse.json(ok(await getScenarioDetail(ctx.projectId, id)));
  } catch (err) {
    return toResponse(err);
  }
});

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:UPDATE");
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const parsed = scenarioSaveSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await updateScenario(ctx.projectId, ctx.userId, id, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:DELETE");
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return NextResponse.json(ok(await deleteScenario(ctx.projectId, ctx.userId, id)));
  } catch (err) {
    return toResponse(err);
  }
});
