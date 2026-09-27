import { NextResponse } from "next/server";
import { z } from "zod";
import { ok, apiCaseUpsertSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { updateCase, deleteCase } from "@/server/domains/api/api-case.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

const updateSchema = apiCaseUpsertSchema.extend({ version: z.number().int() });

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:UPDATE");
    ctx.requireWritable();
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(
      ok(await updateCase(ctx.projectId, caseId, ctx.userId, parsed.data)),
    );
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:DELETE");
    ctx.requireWritable();
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    return NextResponse.json(ok(await deleteCase(ctx.projectId, caseId)));
  } catch (err) {
    return toResponse(err);
  }
});
