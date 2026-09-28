import { okResponse, toResponse, withAuth } from "@/server/guard";
import * as svc from "@/server/domains/system/personal.service";

export const runtime = "nodejs";

/** SYS-007：本地 runner 连通检测（3s 超时；仅环回地址）。 */
export const POST = withAuth(async (ctx) => {
  try {
    return okResponse(await svc.checkLocalRunner(ctx.userId));
  } catch (err) {
    return toResponse(err);
  }
});
