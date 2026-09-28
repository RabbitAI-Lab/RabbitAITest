import { NextResponse } from "next/server";
import { toResponse, okResponse } from "@/server/guard";
import { ErrCode, openApiCaptureSchema } from "@rabbit/shared";
import { withApiKey, assertProjectVisible } from "@/server/open-api-guard";
import { captureApiDefinitions } from "@/server/domains/api/open-sync.service";

export const runtime = "nodejs";

/** S-future TOOL-002：浏览器插件抓包导入（skip-if-exists；敏感头脱敏在 service 层）。 */
export const POST = withApiKey(async (ctx, req) => {
  try {
    const parsed = openApiCaptureSchema.safeParse(await req.json());
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "采集载荷非法";
      const code = /最多|超上限|fewer|at most/i.test(msg)
        ? ErrCode.OPEN_SYNC_LIMIT_EXCEEDED
        : ErrCode.OPEN_CAPTURE_INVALID;
      return NextResponse.json({ code, message: msg, data: null }, { status: 422 });
    }
    await assertProjectVisible(ctx.userId, parsed.data.projectId);
    return okResponse(await captureApiDefinitions(ctx.userId, parsed.data));
  } catch (err) {
    return toResponse(err);
  }
});
