import { NextResponse } from "next/server";
import { ok, messageTemplateUpsertSchema, messageTemplatePreviewSchema } from "@rabbit/shared";
import { withProjectScope, toResponse, zodParse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import * as tpl from "@/server/domains/message/template.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ projectId: string }> };

/** 11 事件模板全量（未定制=默认标记）。 */
export const GET = withProjectScope(async (ctx, _req, _seg) => {
  try {
    ctx.requirePerm("PROJECT_MESSAGE:READ");
    return NextResponse.json(ok(await tpl.listTemplates(ctx.projectId)));
  } catch (err) {
    return toResponse(err);
  }
});

/** upsert 单事件模板（ENTP-005；MSG_TEMPLATE 门控）。 */
export const PUT = withProjectScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm("PROJECT_MESSAGE:UPDATE");
    ctx.requireWritable();
    await assertEntpEnabled("MSG_TEMPLATE");
    const input = zodParse(messageTemplateUpsertSchema, await req.json());
    const result = await tpl.upsertTemplate(ctx.projectId, input);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "template.upsert",
      objectType: "message_template",
      objectId: input.event,
      detail: { event: input.event },
    });
    void flushAudit();
    return NextResponse.json(ok(result));
  } catch (err) {
    return toResponse(err);
  }
});

// 实时预览已迁移至静态子路由 preview/（POST 会被兄弟动态段 [event] 405 吞并——S9 勘误 2）
