import { NextResponse } from "next/server";
import { z } from "zod";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import { runUiCaseBatch } from "@/server/domains/exec/uit.service";

export const runtime = "nodejs";

const batchSchema = z.object({
  caseIds: z.array(z.string().uuid()).min(1).max(20),
});

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

/** 批量执行（UIT-002 §4：≤20 用例，ui_batch 命令；item 级串行复用池并发面）。 */
export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_UIT:EXECUTE");
    ctx.requireWritable();
    await assertEntpEnabled("UI_TEST");
    const parsed = batchSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(
      ok(await runUiCaseBatch(ctx.projectId, parsed.data.caseIds, ctx.userId)),
      { status: 202 },
    );
  } catch (err) {
    return toResponse(err);
  }
});
