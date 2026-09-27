import { NextResponse } from "next/server";
import { ok, fileUpdateSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { updateFile, deleteFile } from "@/server/domains/project/file.service";

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

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_FILE:DELETE");
    ctx.requireWritable();
    const { fileId } = await (seg as { params: Promise<{ fileId: string }> }).params;
    return NextResponse.json(ok(await deleteFile(ctx.projectId, fileId)));
  } catch (err) {
    return toResponse(err);
  }
});
