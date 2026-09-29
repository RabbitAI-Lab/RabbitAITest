import { NextResponse } from "next/server";
import { ok, mockUpsertSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { listMocks, createMock } from "@/server/domains/api/mock.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:READ");
    const { apiId } = await (seg as { params: Promise<{ apiId: string }> }).params;
    return NextResponse.json(ok(await listMocks(ctx.projectId, apiId)));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:CREATE");
    ctx.requireWritable();
    const { apiId } = await (seg as { params: Promise<{ apiId: string }> }).params;
    const parsed = mockUpsertSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await createMock(ctx.projectId, ctx.userId, apiId, parsed.data)), {
      status: 201,
    });
  } catch (err) {
    return toResponse(err);
  }
});
