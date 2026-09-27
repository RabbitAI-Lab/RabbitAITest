import { NextResponse } from "next/server";
import { toResponse, okResponse } from "@/server/guard";
import { withApiKey, assertProjectVisible } from "@/server/open-api-guard";
import { prisma } from "@rabbit/db";

export const runtime = "nodejs";

/** INTG-003：任务状态轮询（open；CI 门禁主入口；summary 取自 Report 聚合）。 */
export const GET = withApiKey(async (ctx, _req, seg) => {
  try {
    const { taskId } = await (seg as { params: Promise<{ taskId: string }> }).params;
    const task = await prisma.execTask.findUnique({
      where: { id: taskId },
      select: { id: true, projectId: true, status: true, finishedAt: true },
    });
    if (!task) return NextResponse.json({ code: 40404, message: "任务不存在", data: null }, { status: 404 });
    await assertProjectVisible(ctx.userId, task.projectId);
    const report = await prisma.report.findFirst({
      where: { taskId },
      select: { summary: true },
    });
    const raw = report?.summary;
    const parsed = (typeof raw === "string" ? JSON.parse(raw) : (raw ?? {})) as {
      total?: number;
      success?: number;
      failed?: number;
    };
    return okResponse({
      taskId: task.id,
      status: task.status,
      summary: {
        total: parsed.total ?? 0,
        success: parsed.success ?? 0,
        failed: parsed.failed ?? 0,
      },
      finishedAt: task.finishedAt?.toISOString() ?? null,
    });
  } catch (err) {
    return toResponse(err);
  }
});
