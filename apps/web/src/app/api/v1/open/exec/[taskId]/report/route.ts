import { NextResponse } from "next/server";
import { toResponse, okResponse } from "@/server/guard";
import { withApiKey, assertProjectVisible } from "@/server/open-api-guard";
import { prisma } from "@rabbit/db";

export const runtime = "nodejs";

/** INTG-003：报告摘要（open；白名单字段——RPT-002 摘要子集口径，不含敏感环境面）。 */
export const GET = withApiKey(async (ctx, _req, seg) => {
  try {
    const { taskId } = await (seg as { params: Promise<{ taskId: string }> }).params;
    const task = await prisma.execTask.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });
    if (!task)
      return NextResponse.json({ code: 40404, message: "任务不存在", data: null }, { status: 404 });
    await assertProjectVisible(ctx.userId, task.projectId);
    const report = await prisma.report.findFirst({
      where: { taskId },
      select: { id: true, name: true, reportType: true, summary: true, createdAt: true },
    });
    if (!report)
      return NextResponse.json({ code: 60404, message: "报告不存在", data: null }, { status: 404 });
    const raw = report.summary;
    const summary = (typeof raw === "string" ? JSON.parse(raw) : (raw ?? {})) as Record<
      string,
      unknown
    >;
    return okResponse({
      reportId: report.id,
      name: report.name,
      reportType: report.reportType,
      summary: {
        total: summary.total ?? 0,
        success: summary.success ?? 0,
        failed: summary.failed ?? 0,
        fakeError: summary.fakeError ?? 0,
        durationMs: summary.durationMs ?? 0,
      },
      createdAt: report.createdAt.toISOString(),
    });
  } catch (err) {
    return toResponse(err);
  }
});
