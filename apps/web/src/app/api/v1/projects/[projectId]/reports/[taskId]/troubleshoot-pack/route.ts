/**
 * INFRA-004：失败任务排障包直下端点。
 * POST /api/v1/projects/{pid}/reports/{id}/troubleshoot-pack
 *  - 任务终态 FAILED → 200 application/json 附件（manifest+事件流末 50 帧+日志说明）
 *  - 非 FAILED → 422 70060（防直发）；报告不存在/越域 → 404（防枚举）
 */
import { NextResponse } from "next/server";
import { withProjectScope } from "@/server/guard";
import { buildTroubleshootPack } from "@/server/domains/exec/troubleshoot.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withProjectScope(async (ctx, _req, seg) => {
  ctx.requirePerm("PROJECT_REPORT:READ");
  const { taskId } = await (seg as { params: Promise<{ taskId: string }> }).params;
  const pack = await buildTroubleshootPack(ctx.projectId, taskId);
  return new NextResponse(pack.body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${pack.filename}"`,
      "cache-control": "no-store",
    },
  });
});
