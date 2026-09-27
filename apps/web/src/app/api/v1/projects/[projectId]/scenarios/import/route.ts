import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { importScenarios } from "@/server/domains/api/scenario-io.service";

export const runtime = "nodejs";

/** 导入落库（multipart file + moduleId?；导入=新建，幂等口径见 API-009 §2）。 */
export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:CREATE");
    ctx.requireWritable();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ code: 20422, message: "缺少 file 字段", data: null }, { status: 422 });
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ code: 50010, message: "导入文件超出大小上限（2MB）", data: null }, { status: 422 });
    }
    const moduleId = form.get("moduleId");
    const content = await file.text();
    const r = await importScenarios(ctx.projectId, ctx.userId, file.name, content, typeof moduleId === "string" && moduleId ? moduleId : undefined);
    return NextResponse.json(ok(r), { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
});
