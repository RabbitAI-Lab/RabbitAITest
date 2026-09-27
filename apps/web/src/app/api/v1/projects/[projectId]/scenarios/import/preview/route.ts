import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { previewImport } from "@/server/domains/api/scenario-io.service";

export const runtime = "nodejs";

const ALLOWED = [".json", ".jmx"];

/** 导入预览（multipart file → 解析摘要不落库，API-009 §3）。 */
export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:CREATE");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ code: 20422, message: "缺少 file 字段", data: null }, { status: 422 });
    const name = file.name.toLowerCase();
    if (!ALLOWED.some((ext) => name.endsWith(ext))) {
      return NextResponse.json({ code: 50011, message: "导入格式无法识别（支持 .json / .jmx）", data: null }, { status: 422 });
    }
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ code: 50010, message: "导入文件超出大小上限（2MB）", data: null }, { status: 422 });
    }
    const content = await file.text();
    return NextResponse.json(ok(previewImport(file.name, content)));
  } catch (err) {
    return toResponse(err);
  }
});
