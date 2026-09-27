import { okResponse, toResponse, withProjectScope, zodParse } from "@/server/guard";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { robotUpsertSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/message/robot.service";

export const runtime = "nodejs";

/** MSG-001：机器人列表/新建（PROJECT_MESSAGE 点）。 */
export const GET = withProjectScope(async (ctx) => {
  try {
    ctx.requirePerm("PROJECT_MESSAGE:READ");
    return okResponse(await svc.listRobots(ctx.projectId));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_MESSAGE:CREATE");
    ctx.requireWritable();
    const body = zodParse(robotUpsertSchema, await req.json());
    const created = await svc.createRobot(ctx.projectId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "robot.create",
      objectType: "robot",
      objectId: created.id,
      detail: { name: created.name, channel: created.channel },
    });
    void flushAudit();
    return okResponse(created, 201);
  } catch (err) {
    return toResponse(err);
  }
});
