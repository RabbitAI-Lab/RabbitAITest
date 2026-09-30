import { NextResponse } from "next/server";
import { ok, uiElementCreateSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import { listUiElements, createUiElement } from "@/server/domains/exec/uit.service";
import { uiElementListQuerySchema } from "@/server/domains/exec/load.schemas";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_UIT:READ");
    const parsed = uiElementListQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await listUiElements(ctx.projectId, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_UIT:CREATE");
    ctx.requireWritable();
    await assertEntpEnabled("UI_TEST");
    const parsed = uiElementCreateSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await createUiElement(ctx.projectId, parsed.data)), {
      status: 201,
    });
  } catch (err) {
    return toResponse(err);
  }
});
