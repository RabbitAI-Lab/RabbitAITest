import { NextResponse } from "next/server";
import { heartbeatSchema, ok } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { config } from "@rabbit/shared";
import { withInternalToken, toResponse } from "@/server/guard";

export const runtime = "nodejs";

/** engine 节点注册 + 心跳（EXEC-001 §4；P0 单默认池 upsert 节点信息）。 */
export const POST = withInternalToken(async (req) => {
  try {
    const parsed = heartbeatSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { code: 50001, message: "心跳载荷非法", data: null },
        { status: 422 },
      );
    }
    const pool = await prisma.resourcePool.findUnique({
      where: { id: config.defaultPoolId },
      select: { nodes: true },
    });
    const nodes = (pool?.nodes ?? []) as {
      nodeId: string;
      version: string;
      slots: number;
      ts: number;
    }[];
    const next = [...nodes.filter((n) => n.nodeId !== parsed.data.nodeId), parsed.data];
    await prisma.resourcePool.update({
      where: { id: config.defaultPoolId },
      data: { nodes: next, lastBeatAt: new Date() },
    });
    return NextResponse.json(ok({ poolId: config.defaultPoolId }));
  } catch (err) {
    return toResponse(err);
  }
});
