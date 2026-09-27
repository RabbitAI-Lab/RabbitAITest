import { NextResponse } from "next/server";
import { ok, reportListQuerySchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { listReports } from "@/server/domains/exec/exec.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_REPORT:READ");
    const parsed = reportListQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await listReports(ctx.projectId, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});
