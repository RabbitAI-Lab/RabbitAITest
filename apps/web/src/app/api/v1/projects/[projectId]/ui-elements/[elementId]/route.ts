import { NextResponse } from "next/server";
import { ok, uiElementUpdateSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import { updateUiElement, deleteUiElement } from "@/server/domains/exec/uit.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const PUT = withProjectScope(async (ctx, req, segArg?: unknown) => {
  try {
    ctx.requirePerm("PROJECT_UIT:UPDATE");
    ctx.requireWritable();
    await assertEntpEnabled("UI_TEST");
    const { elementId } = await (segArg as { params: Promise<{ elementId: string }> }).params;
    const parsed = uiElementUpdateSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await updateUiElement(ctx.projectId, elementId, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, segArg?: unknown) => {
  try {
    ctx.requirePerm("PROJECT_UIT:DELETE");
    ctx.requireWritable();
    await assertEntpEnabled("UI_TEST");
    const { elementId } = await (segArg as { params: Promise<{ elementId: string }> }).params;
    return NextResponse.json(ok(await deleteUiElement(ctx.projectId, elementId)));
  } catch (err) {
    return toResponse(err);
  }
});
