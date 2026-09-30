import { NextResponse } from "next/server";
import { config } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { withAuth } from "@/server/guard";
import { redis } from "@/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SSE 施压度量流（LOAD-003 §4）：XREAD 阻塞读 + Last-Event-ID 续传 + 任务终态关闭。
 *  与 /stream/exec 同构，数据面=load:stream:{taskId}（loadMetricFrame）。 */
export const GET = withAuth(async (ctx, req: Request, segArg?: unknown) => {
  const seg = segArg as { params: Promise<{ taskId: string }> };
  const { taskId } = await seg.params;
  const task = await prisma.execTask.findFirst({
    where: { id: taskId, type: "load" },
    select: { id: true, projectId: true, status: true },
  });
  const visible = task
    ? await prisma.projectMember.findFirst({
        where: { projectId: task.projectId, userId: ctx.userId },
        select: { id: true },
      })
    : null;
  if (!task || !visible) {
    return NextResponse.json(
      { code: 60404, message: "任务不存在或无权访问", data: null },
      { status: 404 },
    );
  }
  const streamKey = config.loadStreamKey(taskId);
  let cursor = req.headers.get("last-event-id") ?? "0";

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (frame: { id: string; data: unknown }) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`id: ${frame.id}\ndata: ${JSON.stringify(frame.data)}\n\n`),
        );
      };
      const deadline = Date.now() + 15 * 60 * 1000; // 施压时长上限 10 分钟 + 余量
      try {
        for (let i = 0; i < 1800 && !closed && Date.now() < deadline; i++) {
          const results = await redis().xread(
            "BLOCK",
            3000,
            "STREAMS",
            streamKey,
            cursor === "0" ? "0" : cursor,
          );
          if (results) {
            for (const [, entries] of results) {
              for (const [id, fields] of entries) {
                cursor = id;
                const json = fields[fields.indexOf("data") + 1];
                if (!json) continue;
                try {
                  send({ id, data: JSON.parse(json as string) });
                } catch {
                  // 坏帧跳过
                }
              }
            }
          }
          // 终态判定：DB 终态即关流（任务状态由引擎回调回写）
          const t = await prisma.execTask.findFirst({
            where: { id: taskId },
            select: { status: true },
          });
          if (t && t.status !== "RUNNING" && t.status !== "PENDING") break;
        }
      } catch {
        // 客户端断开等：安全退出
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      /* 由 finally 收口 */
    },
  });

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  }) as unknown as NextResponse;
});
