import { NextResponse } from "next/server";
import { toResponse, okResponse } from "@/server/guard";
import { ErrCode, openApiSyncSchema } from "@rabbit/shared";
import { withApiKey, assertProjectVisible } from "@/server/open-api-guard";
import { syncApiDefinitions } from "@/server/domains/api/open-sync.service";

export const runtime = "nodejs";

/** S-future TOOL-001：IDEA 插件批量同步（upsert，幂等键 method+path；鉴权/限流/审计走 withApiKey）。 */
export const POST = withApiKey(async (ctx, req) => {
  try {
    const parsed = openApiSyncSchema.safeParse(await req.json());
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "同步载荷非法";
      const code = /最多|超上限|fewer|at most/i.test(msg)
        ? ErrCode.OPEN_SYNC_LIMIT_EXCEEDED
        : ErrCode.OPEN_SYNC_VALIDATION_FAILED;
      return NextResponse.json({ code, message: msg, data: null }, { status: 422 });
    }
    await assertProjectVisible(ctx.userId, parsed.data.projectId);
    return okResponse(await syncApiDefinitions(ctx.userId, parsed.data));
  } catch (err) {
    return toResponse(err);
  }
});
