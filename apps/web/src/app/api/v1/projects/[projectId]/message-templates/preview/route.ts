import { NextResponse } from "next/server";
import { ok, messageTemplatePreviewSchema } from "@rabbit/shared";
import { withProjectScope, toResponse, zodParse } from "@/server/guard";
import { previewTemplate } from "@/server/domains/message/template.service";

export const runtime = "nodejs";

/**
 * 实时预览（示例数据渲染，不落库；ENTP-005）。
 * 静态段 preview 优先于兄弟动态段 [event]（preview POST 会被后者 405 吞并——S9 勘误 2）。
 */
export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_MESSAGE:READ");
    const input = zodParse(messageTemplatePreviewSchema, await req.json());
    return NextResponse.json(ok(await previewTemplate(ctx.projectId, input)));
  } catch (err) {
    return toResponse(err);
  }
});
