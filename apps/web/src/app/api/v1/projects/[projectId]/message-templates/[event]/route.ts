import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import { deleteTemplate } from "@/server/domains/message/template.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ projectId: string; event: string }> };

/** 恢复默认模板（幂等；ENTP-005；MSG_TEMPLATE 门控）。 */
export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_MESSAGE:UPDATE");
    ctx.requireWritable();
    await assertEntpEnabled("MSG_TEMPLATE");
    const { event } = await (seg as Seg).params;
    const result = await deleteTemplate(ctx.projectId, event);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "template.reset",
      objectType: "message_template",
      objectId: event,
      detail: { event },
    });
    void flushAudit();
    return NextResponse.json(ok(result));
  } catch (err) {
    return toResponse(err);
  }
});
