import { NextResponse } from "next/server";
import { ok, environmentImportSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { importEnvironments } from "@/server/domains/project/environment.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_ENV:CREATE");
    ctx.requireWritable();
    const parsed = environmentImportSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await importEnvironments(ctx.projectId, ctx.userId, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});
