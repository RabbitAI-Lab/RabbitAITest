import { NextResponse } from "next/server";
import { ok, environmentUpsertSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { listEnvironments, createEnvironment } from "@/server/domains/project/environment.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const GET = withProjectScope(async (ctx) => {
  try {
    ctx.requirePerm("PROJECT_ENV:READ");
    return NextResponse.json(ok(await listEnvironments(ctx.projectId)));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_ENV:CREATE");
    ctx.requireWritable();
    const parsed = environmentUpsertSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(
      ok(await createEnvironment(ctx.projectId, ctx.userId, parsed.data)),
      { status: 201 },
    );
  } catch (err) {
    return toResponse(err);
  }
});
