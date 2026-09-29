import { NextResponse } from "next/server";
import { EXEC_CONTRACT_VERSION, heartbeatSchema, ok } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { config } from "@rabbit/shared";
import { withInternalToken, toResponse } from "@/server/guard";

export const runtime = "nodejs";

/**
 * engine 节点注册 + 心跳（EXEC-002 v2 + ENTP-006）：upsert 节点（busy 槽位）+ 响应下发 maxConcurrency；
 * taskIds = 该节点在执任务（web touch updatedAt，任务中心 STUCK 判定数据源，SYS-006 §2）。
 * S9：body.poolId 定位绑定池（缺省回落默认池——旧引擎兼容）；DISABLED 池心跳返回 50011。
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
    const poolId = body.poolId ?? config.defaultPoolId;
    const pool = await prisma.resourcePool.findUnique({
      where: { id: poolId },
      select: { nodes: true, maxConcurrency: true, status: true },
    });
    if (!pool) {
      return NextResponse.json(
        { code: 50404, message: "资源池不存在（POOL_ID 指向的池未创建或已删除）", data: null },
        { status: 404 },
      );
    }
    if (pool.status !== "ACTIVE") {
      return NextResponse.json(
        { code: 90032, message: "资源池已禁用，引擎心跳被拒绝", data: null },
        { status: 502 },
      );
    }
    const nodes = (pool?.nodes ?? []) as {
      nodeId: string;
      version: string;
      slots: number;
      busy?: number;
      ts: number;
    }[];
    const { poolId: _ignored, ...beat } = body;
    const next = [
      ...nodes.filter((n) => n.nodeId !== beat.nodeId),
      { ...beat, version: beat.version, slots: beat.slots, ts: beat.ts },
    ];
    await prisma.resourcePool.update({
      where: { id: poolId },
      data: { nodes: next, lastBeatAt: new Date() },
    });
    if (Array.isArray(body.taskIds) && body.taskIds.length > 0) {
      await prisma.execTask
        .updateMany({
          where: { id: { in: body.taskIds }, status: "RUNNING" },
          data: { updatedAt: new Date() },
        })
        .catch(() => {});
    }
    return NextResponse.json(
      ok({
        poolId,
        maxConcurrency: pool?.maxConcurrency ?? 4,
        contractVersion: EXEC_CONTRACT_VERSION,
      }),
    );
  } catch (err) {
    return toResponse(err);
  }
});
