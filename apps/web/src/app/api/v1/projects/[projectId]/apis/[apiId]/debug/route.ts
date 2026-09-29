import { NextResponse } from "next/server";
import { z } from "zod";
import { ok, apiRequestBundleSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { debugApi } from "@/server/domains/api/api.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

const debugSchema = z.object({
  request: apiRequestBundleSchema,
  envId: z.string().uuid().optional(),
  clientTaskId: z.string().max(128).optional(),
});

/** 编辑态直接调试（不要求先保存；执行=CREATE 口径）。 */
export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:CREATE");
    ctx.requireWritable();
    const { apiId } = await (seg as { params: Promise<{ apiId: string }> }).params;
    const parsed = debugSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await debugApi(ctx.projectId, ctx.userId, apiId, parsed.data)), {
      status: 201,
    });
  } catch (err) {
    return toResponse(err);
  }
});
