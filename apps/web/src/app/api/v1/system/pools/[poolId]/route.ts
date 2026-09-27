import { NextResponse } from "next/server";
import { z } from "zod";
import { ok } from "@rabbit/shared";
import { withSystemPerm, toResponse } from "@/server/guard";
import { getPool, updatePool } from "@/server/domains/system/pool.service";

export const runtime = "nodejs";

const updateSchema = z.object({
  maxConcurrency: z.number().int().min(2).max(64),
});

export const GET = withSystemPerm("SYSTEM_POOL:READ")(async (_ctx, _req, seg) => {
  try {
    const { poolId } = await (
      seg as { params: Promise<{ poolId: string }> }
    ).params;
    return NextResponse.json(ok(await getPool(poolId)));
  } catch (err) {
    return toResponse(err);
  }
});

export const PUT = withSystemPerm("SYSTEM_POOL:UPDATE")(async (_ctx, req, seg) => {
  try {
    const { poolId } = await (
      seg as { params: Promise<{ poolId: string }> }
    ).params;
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 20422,
          message: parsed.error.issues[0]?.message ?? "参数校验失败",
          data: null,
        },
        { status: 422 },
      );
    }
    return NextResponse.json(ok(await updatePool(poolId, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});
