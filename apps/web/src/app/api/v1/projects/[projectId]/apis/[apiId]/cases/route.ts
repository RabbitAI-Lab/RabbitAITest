import { NextResponse } from "next/server";
import { ok, apiCaseListQuerySchema, apiCaseUpsertSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { listCases, createCase } from "@/server/domains/api/api-case.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const GET = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:READ");
    const { apiId } = await (seg as { params: Promise<{ apiId: string }> }).params;
    const parsed = apiCaseListQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await listCases(ctx.projectId, apiId, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:CREATE");
    ctx.requireWritable();
    const { apiId } = await (seg as { params: Promise<{ apiId: string }> }).params;
    const parsed = apiCaseUpsertSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(
      ok(await createCase(ctx.projectId, ctx.userId, apiId, parsed.data)),
      { status: 201 },
    );
  } catch (err) {
    return toResponse(err);
  }
});
