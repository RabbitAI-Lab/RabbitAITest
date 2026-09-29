import { NextResponse } from "next/server";
import { ok, scenarioBatchOpSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { batchCopy } from "@/server/domains/api/scenario.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:CREATE");
    ctx.requireWritable();
    const parsed = scenarioBatchOpSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await batchCopy(ctx.projectId, ctx.userId, parsed.data)), {
      status: 201,
    });
  } catch (err) {
    return toResponse(err);
  }
});
