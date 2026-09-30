import { NextResponse } from "next/server";
import { ok, uiCaseUpdateSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import {
  getUiCase,
  updateUiCase,
  deleteUiCase,
} from "@/server/domains/exec/uit.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const GET = withProjectScope(async (ctx, _req, segArg?: unknown) => {
  try {
    ctx.requirePerm("PROJECT_UIT:READ");
    const { caseId } = await (segArg as { params: Promise<{ caseId: string }> }).params;
    return NextResponse.json(ok(await getUiCase(ctx.projectId, caseId)));
  } catch (err) {
    return toResponse(err);
  }
});

export const PUT = withProjectScope(async (ctx, req, segArg?: unknown) => {
  try {
    ctx.requirePerm("PROJECT_UIT:UPDATE");
    ctx.requireWritable();
    await assertEntpEnabled("UI_TEST");
    const { caseId } = await (segArg as { params: Promise<{ caseId: string }> }).params;
    const parsed = uiCaseUpdateSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await updateUiCase(ctx.projectId, caseId, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, segArg?: unknown) => {
  try {
    ctx.requirePerm("PROJECT_UIT:DELETE");
    ctx.requireWritable();
    await assertEntpEnabled("UI_TEST");
    const { caseId } = await (segArg as { params: Promise<{ caseId: string }> }).params;
    return NextResponse.json(ok(await deleteUiCase(ctx.projectId, caseId)));
  } catch (err) {
    return toResponse(err);
  }
});
