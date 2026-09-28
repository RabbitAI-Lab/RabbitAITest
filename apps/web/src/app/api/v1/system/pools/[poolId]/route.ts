import { NextResponse } from "next/server";
import { ok, ErrCode, poolUpdateSchema } from "@rabbit/shared";
import { withSystemPerm, toResponse } from "@/server/guard";
import { getPool, updatePool, testPoolK8sConnection } from "@/server/domains/system/pool.service";

export const runtime = "nodejs";

export const GET = withSystemPerm("SYSTEM_POOL:READ")(async (_ctx, _req, seg) => {
  try {
    const { poolId } = await (seg as { params: Promise<{ poolId: string }> }).params;
    return NextResponse.json(ok(await getPool(poolId)));
  } catch (err) {
    return toResponse(err);
  }
});

/** EXEC-002 并发编辑 + S-future EXEC-004 型切换/K8S 配置；?test=true=连通性试连（不落库，50423=502）。 */
export const PUT = withSystemPerm("SYSTEM_POOL:UPDATE")(async (_ctx, req, seg) => {
  try {
    const { poolId } = await (seg as { params: Promise<{ poolId: string }> }).params;
    const parsed = poolUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: ErrCode.VALIDATION_FAILED,
          message: parsed.error.issues[0]?.message ?? "参数校验失败",
          data: null,
        },
        { status: 422 },
      );
    }
    const isTest = new URL(req.url).searchParams.get("test") === "true";
    if (isTest) {
      return NextResponse.json(ok(await testPoolK8sConnection(poolId, parsed.data)));
    }
    return NextResponse.json(ok(await updatePool(poolId, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});
