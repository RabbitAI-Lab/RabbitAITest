import { NextResponse } from 'next/server';
import { config, eventFrameSchema } from '@rabbit/shared';
import { prisma } from '@rabbit/db';
import { withAuth } from '@/server/guard';
import { redis } from '@/server/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** SSE 执行事件流（api-conventions §5）：XREAD 阻塞读 + Last-Event-ID 续传 + 终态关闭。 */
export const GET = withAuth(async (ctx, req: Request, segArg?: unknown) => {
  const seg = segArg as { params: Promise<{ taskId: string }> };
  const { taskId } = await seg.params;
  // 权限：任务必须属于当前用户可见项目
  const task = await prisma.execTask.findFirst({
    where: { id: taskId },
    select: { id: true, projectId: true, status: true },
  });
  const visible = task
    ? await prisma.projectMember.findFirst({
        where: { projectId: task.projectId, userId: ctx.userId },
        select: { id: true },
      })
    : null;
  if (!task || !visible) {
    return NextResponse.json({ code: 60404, message: '任务不存在或无权访问', data: null }, { status: 404 });
  }
  const streamKey = config.execStreamKey(taskId);
  const lastEventId = req.headers.get('last-event-id') ?? '0';
  let cursor = lastEventId;

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (frame: { id: string; data: unknown }) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`id: ${frame.id}\ndata: ${JSON.stringify(frame.data)}\n\n`));
      };
      const deadline = Date.now() + 10 * 60 * 1000;
      try {
        for (let i = 0; i < 720 && !closed && Date.now() < deadline; i++) {
          const results = await redis().xread(
            'BLOCK', 5000, 'STREAMS', streamKey, cursor === '0' ? '0' : cursor,
          );
          if (results) {
            for (const [streamName, entries] of results) {
              void streamName;
              for (const [id, fields] of entries) {
                cursor = id;
                const json = fields[fields.indexOf('data') + 1];
                if (!json) continue;
                try {
                  send({ id, data: JSON.parse(json as string) });
                } catch {
                  // 坏帧跳过
                }
              }
            }
          }
          // 终态判定：收到 task-final 或 DB 终态 → 关闭
          const tail = await redis().xrevrange(streamKey, '+', '-', 'COUNT', 1);
          const tailJson = tail?.[0]?.[1] ?? [];
          const tailData = tailJson[tailJson.indexOf('data') + 1];
          let isFinal = false;
          if (tailData) {
            try {
              const frame = eventFrameSchema.parse(JSON.parse(tailData as string));
              isFinal = frame.type === 'task-final';
            } catch { /* ignore */ }
          }
          if (!isFinal) {
            const t = await prisma.execTask.findFirst({
              where: { id: taskId }, select: { status: true },
            });
            isFinal = t?.status === 'SUCCESS' || t?.status === 'FAILED';
          }
          if (isFinal) break;
        }
      } catch {
        // 客户端断开等：安全退出
      } finally {
        closed = true;
        try {
          controller.close();
        } catch { /* already closed */ }
      }
    },
    cancel() { /* 由 finally 收口 */ },
  });

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  }) as unknown as NextResponse;
});
