import { NextResponse } from "next/server";
import { ok, shareCreateSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { listShares, createShare } from "@/server/domains/exec/exec.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_REPORT:READ");
    const { taskId } = await (seg as { params: Promise<{ taskId: string }> }).params;
    return NextResponse.json(ok(await listShares(ctx.projectId, taskId)));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_REPORT:SHARE");
    ctx.requireWritable();
    const { taskId } = await (seg as { params: Promise<{ taskId: string }> }).params;
    const parsed = shareCreateSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(
      ok(await createShare(ctx.projectId, taskId, parsed.data.expireHours)),
      { status: 201 },
    );
  } catch (err) {
    return toResponse(err);
  }
});
