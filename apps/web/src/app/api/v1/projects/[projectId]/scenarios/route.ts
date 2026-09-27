import { NextResponse } from "next/server";
import { ok, scenarioCreateSchema, scenarioListQuerySchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { listScenarios, createScenario } from "@/server/domains/api/scenario.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json({ code: 20422, message: message ?? "参数校验失败", data: null }, { status: 422 });

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:READ");
    const parsed = scenarioListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await listScenarios(ctx.projectId, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:CREATE");
    ctx.requireWritable();
    const parsed = scenarioCreateSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await createScenario(ctx.projectId, ctx.userId, parsed.data)), { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
});
