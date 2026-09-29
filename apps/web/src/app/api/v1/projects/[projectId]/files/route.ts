import { NextResponse } from "next/server";
import { ok, fileListQuerySchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { listFiles, uploadFile } from "@/server/domains/project/file.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_FILE:READ");
    const parsed = fileListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await listFiles(ctx.projectId, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_FILE:CREATE");
    ctx.requireWritable();
    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof File)) {
      return NextResponse.json(
        { code: 20422, message: "缺少 multipart 字段 file", data: null },
        { status: 422 },
      );
    }
    return NextResponse.json(
      ok(
        await uploadFile(ctx.projectId, ctx.userId, {
          name: f.name,
          mime: f.type,
          buffer: Buffer.from(await f.arrayBuffer()),
        }),
      ),
      { status: 201 },
    );
  } catch (err) {
    return toResponse(err);
  }
});
