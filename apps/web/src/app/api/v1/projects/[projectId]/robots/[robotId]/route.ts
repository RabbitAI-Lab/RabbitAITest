import { okResponse, toResponse, withProjectScope, zodParse } from "@/server/guard";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { robotUpsertSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/message/robot.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ robotId: string }> };

/** MSG-001：机器人编辑/删除。 */
export const PATCH = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_MESSAGE:UPDATE");
    ctx.requireWritable();
    const { robotId } = await (seg as Seg).params;
    const body = zodParse(robotUpsertSchema, await req.json());
    const updated = await svc.updateRobot(ctx.projectId, robotId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "robot.update",
      objectType: "robot",
      objectId: robotId,
      detail: { name: updated.name, channel: updated.channel },
    });
    void flushAudit();
    return okResponse(updated);
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_MESSAGE:DELETE");
    ctx.requireWritable();
    const { robotId } = await (seg as Seg).params;
    await svc.deleteRobot(ctx.projectId, robotId);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "robot.delete",
      objectType: "robot",
      objectId: robotId,
    });
    void flushAudit();
    return okResponse({ id: robotId });
  } catch (err) {
    return toResponse(err);
  }
});
