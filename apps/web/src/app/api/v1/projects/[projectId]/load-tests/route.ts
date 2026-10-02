import { NextResponse } from "next/server";
import { ok, loadTestCreateSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import { listLoadTests, createLoadTest } from "@/server/domains/exec/load.service";
import { loadTestListQuerySchema } from "@/server/domains/exec/load.schemas";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_LOAD:READ");
    const parsed = loadTestListQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await listLoadTests(ctx.projectId, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_LOAD:CREATE");
    ctx.requireWritable();
    // 先权限后门控（S9 ENTP-007 口径）
    await assertEntpEnabled("LOAD_TEST");
    const parsed = loadTestCreateSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await createLoadTest(ctx.projectId, ctx.userId, parsed.data)), {
      status: 201,
    });
  } catch (err) {
    return toResponse(err);
  }
});
