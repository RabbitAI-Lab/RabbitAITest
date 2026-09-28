import { NextResponse } from "next/server";
import { toResponse, okResponse } from "@/server/guard";
import { openApiDefinitionQuerySchema } from "@rabbit/shared";
import { withApiKey, assertProjectVisible } from "@/server/open-api-guard";
import { listApiDefinitionsForOpen } from "@/server/domains/api/open-sync.service";

export const runtime = "nodejs";

/** S-future TOOL-001 §4：插件侧对账回读（分页信封）。 */
export const GET = withApiKey(async (ctx, req) => {
  try {
    const parsed = openApiDefinitionQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { code: 20422, message: parsed.error.issues[0]?.message ?? "参数校验失败", data: null },
        { status: 422 },
      );
    }
    await assertProjectVisible(ctx.userId, parsed.data.projectId);
    return okResponse(await listApiDefinitionsForOpen(parsed.data.projectId, parsed.data));
  } catch (err) {
    return toResponse(err);
  }
});
