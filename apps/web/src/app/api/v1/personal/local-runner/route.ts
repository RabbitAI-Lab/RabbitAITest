import { okResponse, toResponse, withAuth, zodParse } from "@/server/guard";
import { localRunnerUpsertSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/system/personal.service";

export const runtime = "nodejs";

/** SYS-007：本地执行配置（环回地址 + 优先本地开关；UserPreference 承载）。 */
export const GET = withAuth(async (ctx) => {
  try {
    return okResponse(await svc.getLocalRunner(ctx.userId));
  } catch (err) {
    return toResponse(err);
  }
});

export const PUT = withAuth(async (ctx, req: Request) => {
  try {
    const body = zodParse(localRunnerUpsertSchema, await req.json());
    return okResponse(await svc.putLocalRunner(ctx.userId, body));
  } catch (err) {
    return toResponse(err);
  }
});
