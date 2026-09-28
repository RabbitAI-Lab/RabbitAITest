import { NextResponse } from "next/server";
import { ok, apiUpdateSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { getApiDetail, updateApi, deleteApi } from "@/server/domains/api/api.service";

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
    return NextResponse.json(ok(await getApiDetail(ctx.projectId, apiId)));
  } catch (err) {
    return toResponse(err);
  }
});

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:UPDATE");
    ctx.requireWritable();
    const { apiId } = await (seg as { params: Promise<{ apiId: string }> }).params;
    const parsed = apiUpdateSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await updateApi(ctx.projectId, apiId, ctx.userId, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:DELETE");
    ctx.requireWritable();
    const { apiId } = await (seg as { params: Promise<{ apiId: string }> }).params;
    return NextResponse.json(ok(await deleteApi(ctx.projectId, apiId)));
  } catch (err) {
    return toResponse(err);
  }
});
