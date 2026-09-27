import { NextResponse } from "next/server";
import { EXEC_CONTRACT_VERSION, heartbeatSchema, ok } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { config } from "@rabbit/shared";
import { withInternalToken, toResponse } from "@/server/guard";

export const runtime = "nodejs";

/**
 * engine 节点注册 + 心跳（EXEC-002 v2）：upsert 节点（busy 槽位）+ 响应下发 maxConcurrency；
 * taskIds = 该节点在执任务（web touch updatedAt，任务中心 STUCK 判定数据源，SYS-006 §2）。
 */
export const POST = withInternalToken(async (req) => {
  try {
    const parsed = heartbeatSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { code: 50001, message: "心跳载荷非法", data: null },
        { status: 422 },
      );
    }
    const body = parsed.data as typeof parsed.data & { taskIds?: string[] };
    const pool = await prisma.resourcePool.findUnique({
      where: { id: config.defaultPoolId },
      select: { nodes: true, maxConcurrency: true },
    });
    const nodes = (pool?.nodes ?? []) as {
      nodeId: string;
      version: string;
      slots: number;
      busy?: number;
      ts: number;
    }[];
    const next = [
      ...nodes.filter((n) => n.nodeId !== parsed.data.nodeId),
      { ...parsed.data },
    ];
    await prisma.resourcePool.update({
      where: { id: config.defaultPoolId },
      data: { nodes: next, lastBeatAt: new Date() },
    });
    if (Array.isArray(body.taskIds) && body.taskIds.length > 0) {
      await prisma.execTask.updateMany({
        where: { id: { in: body.taskIds }, status: "RUNNING" },
        data: { updatedAt: new Date() },
      }).catch(() => {});
    }
    return NextResponse.json(
      ok({
        poolId: config.defaultPoolId,
        maxConcurrency: pool?.maxConcurrency ?? 4,
        contractVersion: EXEC_CONTRACT_VERSION,
      }),
    );
  } catch (err) {
    return toResponse(err);
  }
});
