import { NextResponse } from "next/server";
import { scenarioExportSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { exportScenarios } from "@/server/domains/api/scenario-io.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:READ");
    const parsed = scenarioExportSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    const data = await exportScenarios(ctx.projectId, parsed.data);
    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="rabbit-scenarios-${Date.now()}.json"`,
        "X-Envelope": "ok",
      },
    });
  } catch (err) {
    return toResponse(err);
  }
});
