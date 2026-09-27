import { NextResponse } from "next/server";
import { withProjectScope, toResponse } from "@/server/guard";
import { exportEnvironment } from "@/server/domains/project/environment.service";

export const runtime = "nodejs";

/** 下载语义：导出对象本身（非信封）。 */
export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_ENV:READ");
    const { envId } = await (seg as { params: Promise<{ envId: string }> }).params;
    const data = await exportEnvironment(ctx.projectId, envId);
    return new NextResponse(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="environment-export.json"',
      },
    });
  } catch (err) {
    return toResponse(err);
  }
});
