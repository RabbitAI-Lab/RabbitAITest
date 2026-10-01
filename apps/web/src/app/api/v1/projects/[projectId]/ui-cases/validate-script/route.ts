import { NextResponse } from "next/server";
import { z } from "zod";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { validateUiScript } from "@/server/domains/exec/uit.service";

export const runtime = "nodejs";

/** S13 UIT-003：脚本校验干跑（ui_validate 任务——engine playwright test --list；前端轮询任务详情取标题清单/错误定位）。 */
const bodySchema = z.object({
  name: z.string().max(128).optional(),
  script: z.string().min(1, "脚本内容不能为空"),
});

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_UIT:CREATE");
    ctx.requireWritable();
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await validateUiScript(ctx.projectId, ctx.userId, parsed.data)), {
      status: 202,
    });
  } catch (err) {
    return toResponse(err);
  }
});
