import { okResponse, toResponse, withProjectScope, zodParse } from "@/server/guard";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { messageEventsConfigSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/message/robot.service";

export const runtime = "nodejs";

/** MSG-001：事件配置（AppSetting key=message.events；五大类 × 接收人/机器人）。 */
export const GET = withProjectScope(async (ctx) => {
  try {
    ctx.requirePerm("PROJECT_MESSAGE:READ");
    return okResponse(await svc.getEventsConfigView(ctx.projectId));
  } catch (err) {
    return toResponse(err);
  }
});

export const PUT = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_MESSAGE:UPDATE");
    ctx.requireWritable();
    const body = zodParse(messageEventsConfigSchema, await req.json());
    const saved = await svc.putEventsConfig(ctx.projectId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "message-config.update",
      objectType: "app_setting",
      objectId: "message.events",
      detail: { events: Object.keys(body).length },
    });
    void flushAudit();
    return okResponse(saved);
  } catch (err) {
    return toResponse(err);
  }
});
