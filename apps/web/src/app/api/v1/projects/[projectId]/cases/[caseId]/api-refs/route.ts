import { NextResponse } from "next/server";
import { z } from "zod";
import { ok, caseApiRefCreateSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import {
  listCaseApiRefs,
  addCaseApiRefs,
  removeCaseApiRef,
} from "@/server/domains/api/api-ref.provider";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE:READ");
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    return NextResponse.json(ok(await listCaseApiRefs("", ctx.projectId, caseId)));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE:UPDATE");
    ctx.requireWritable();
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    const parsed = caseApiRefCreateSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await addCaseApiRefs(ctx.projectId, caseId, parsed.data.refIds)), {
      status: 201,
    });
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE:UPDATE");
    ctx.requireWritable();
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    const refId = new URL(req.url).searchParams.get("refId") ?? "";
    const parsed = z.string().uuid().safeParse(refId);
    if (!parsed.success) return unprocessable("refId 必填且为合法 UUID");
    return NextResponse.json(ok(await removeCaseApiRef(ctx.projectId, caseId, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});
