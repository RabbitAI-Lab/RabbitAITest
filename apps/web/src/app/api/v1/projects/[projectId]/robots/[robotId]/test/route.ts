import { okResponse, toResponse, withProjectScope } from "@/server/guard";
import * as svc from "@/server/domains/message/robot.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ robotId: string }> };

/** MSG-001：机器人测试发送（实时校验 SSRF 与投递，失败 422/回显明细）。 */
export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_MESSAGE:UPDATE");
    const { robotId } = await (seg as Seg).params;
    return okResponse(await svc.testRobot(ctx.projectId, robotId, { userId: ctx.userId, email: ctx.email }));
  } catch (err) {
    return toResponse(err);
  }
});
