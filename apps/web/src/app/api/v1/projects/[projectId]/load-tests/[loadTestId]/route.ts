import { NextResponse } from "next/server";
import { ok, loadTestUpdateSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import {
  getLoadTest,
  updateLoadTest,
  deleteLoadTest,
} from "@/server/domains/exec/load.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const GET = withProjectScope(async (ctx, _req, segArg?: unknown) => {
  try {
    ctx.requirePerm("PROJECT_LOAD:READ");
    const { loadTestId } = await (
      segArg as { params: Promise<{ loadTestId: string }> }
    ).params;
    return NextResponse.json(ok(await getLoadTest(ctx.projectId, loadTestId)));
  } catch (err) {
    return toResponse(err);
  }
});

export const PUT = withProjectScope(async (ctx, req, segArg?: unknown) => {
  try {
    ctx.requirePerm("PROJECT_LOAD:UPDATE");
    ctx.requireWritable();
    await assertEntpEnabled("LOAD_TEST");
    const { loadTestId } = await (
      segArg as { params: Promise<{ loadTestId: string }> }
    ).params;
    const parsed = loadTestUpdateSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await updateLoadTest(ctx.projectId, loadTestId, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, segArg?: unknown) => {
  try {
    ctx.requirePerm("PROJECT_LOAD:DELETE");
    ctx.requireWritable();
    await assertEntpEnabled("LOAD_TEST");
    const { loadTestId } = await (
      segArg as { params: Promise<{ loadTestId: string }> }
    ).params;
    return NextResponse.json(ok(await deleteLoadTest(ctx.projectId, loadTestId)));
  } catch (err) {
    return toResponse(err);
  }
});
