/** AGENT-001：调试台 SSE 事件流（api-conventions §5 同构）：XREAD 阻塞读 + Last-Event-ID 续传 + 终态关闭。 */
import { NextResponse } from "next/server";
import { withAuth } from "@/server/guard";
import { prisma } from "@rabbit/db";
import { redis } from "@/server/redis";
import { agentRunStreamKey } from "@/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (ctx, req: Request, segArg?: unknown) => {
  const seg = segArg as { params: Promise<{ runId: string }> };
  const { runId } = await seg.params;
  const run = await prisma.agentRun.findFirst({
    where: { id: runId },
    select: { id: true, projectId: true, status: true },
  });
  const visible = run
    ? await prisma.projectMember.findFirst({
        where: { projectId: run.projectId, userId: ctx.userId },
        select: { id: true },
      })
    : null;
  if (!run || !visible) {
    return NextResponse.json({ code: 70634, message: "运行不存在或无权访问", data: null }, { status: 404 });
  }
  const streamKey = agentRunStreamKey(runId);
  const lastEventId = req.headers.get("last-event-id") ?? "0";
  let cursor = lastEventId;

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (id: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`id: ${id}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const deadline = Date.now() + 11 * 60 * 1000;
      try {
        for (let i = 0; i < 800 && !closed && Date.now() < deadline; i++) {
          const results = (await redis().xread(
            "BLOCK",
            5000,
            "STREAMS",
            streamKey,
            cursor,
          )) as [string, [id: string, fields: string[]][]] | null;
          if (results) {
            for (const [, entries] of results) {
              for (const entry of entries ?? []) {
                const id = entry?.[0] ?? "";
                const fields = entry?.[1] ?? [];
                cursor = id;
                const map: Record<string, string> = {};
                for (let j = 0; j + 1 < fields.length; j += 2) {
                  const k = fields[j];
                  const v = fields[j + 1];
                  if (k !== undefined && v !== undefined) map[k] = v;
                }
                let payload: unknown = null;
                try {
                  payload = JSON.parse(map.payload ?? "null");
                } catch {
                  payload = map.payload ?? null;
                }
                send(id, { type: map.type ?? "frame", seq: id, payload, ts: Date.now() });
                if (map.type === "final") closed = true;
              }
            }
          }
          // 终态兜底（无 final 帧场景：进程重启等）
          const cur = await prisma.agentRun
            .findUnique({ where: { id: runId }, select: { status: true } })
            .catch(() => null);
          if (cur && ["COMPLETED", "FAILED", "CANCELED"].includes(cur.status) && i > 0) {
            send(cursor, { type: "final", seq: cursor, payload: { status: cur.status }, ts: Date.now() });
            closed = true;
          }
        }
      } catch {
        /* 断流容忍 */
      } finally {
        controller.close();
      }
    },
  });
  return new NextResponse(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  }) as unknown as NextResponse;
});
