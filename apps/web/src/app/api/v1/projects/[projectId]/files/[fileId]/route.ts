import { NextResponse } from "next/server";
import { ok, fileUpdateSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { updateFile, deleteFile, purgeFile } from "@/server/domains/project/file.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_FILE:UPDATE");
    ctx.requireWritable();
    const { fileId } = await (seg as { params: Promise<{ fileId: string }> }).params;
    const parsed = fileUpdateSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await updateFile(ctx.projectId, fileId, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_FILE:DELETE");
    ctx.requireWritable();
    const { fileId } = await (seg as { params: Promise<{ fileId: string }> }).params;
    // S5 FILE-001：?purge=true 彻底删除（物理删+对象清理）；默认软删进回收站
    if (new URL(req.url).searchParams.get("purge") === "true") {
      return NextResponse.json(ok(await purgeFile(ctx.projectId, fileId)));
    }
    return NextResponse.json(ok(await deleteFile(ctx.projectId, fileId)));
  } catch (err) {
    return toResponse(err);
  }
});
