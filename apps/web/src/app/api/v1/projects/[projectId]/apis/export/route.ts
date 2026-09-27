import { NextResponse } from "next/server";
import { apiExportQuerySchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { exportRabbit } from "@/server/domains/api/import.service";

export const runtime = "nodejs";

/** 下载语义：导出对象本身（非信封）。 */
export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_API:READ");
    const url = new URL(req.url);
    const parsed = apiExportQuerySchema.safeParse({
      moduleId: url.searchParams.get("moduleId") ?? undefined,
      ids: url.searchParams.has("ids")
        ? (url.searchParams.get("ids") ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 20422,
          message: parsed.error.issues[0]?.message ?? "参数校验失败",
          data: null,
        },
        { status: 422 },
      );
    }
    const data = await exportRabbit(ctx.projectId, parsed.data);
    return new NextResponse(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="apis-export.json"',
      },
    });
  } catch (err) {
    return toResponse(err);
  }
});
