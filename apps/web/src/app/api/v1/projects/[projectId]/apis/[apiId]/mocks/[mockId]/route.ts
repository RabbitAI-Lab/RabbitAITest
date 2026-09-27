import { NextResponse } from "next/server";
import { ok, mockUpsertSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { updateMock, deleteMock } from "@/server/domains/api/mock.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:UPDATE");
    ctx.requireWritable();
    const { mockId } = await (seg as { params: Promise<{ mockId: string }> }).params;
    const parsed = mockUpsertSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await updateMock(ctx.projectId, mockId, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:DELETE");
    ctx.requireWritable();
    const { mockId } = await (seg as { params: Promise<{ mockId: string }> }).params;
    return NextResponse.json(ok(await deleteMock(ctx.projectId, mockId)));
  } catch (err) {
    return toResponse(err);
  }
});
