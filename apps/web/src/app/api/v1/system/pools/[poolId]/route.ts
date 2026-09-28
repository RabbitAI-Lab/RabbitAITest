import { NextResponse } from "next/server";
import { ok, ErrCode, poolUpdateSchema, poolEntpUpdateSchema } from "@rabbit/shared";
import { withSystemPerm, toResponse, zodParse } from "@/server/guard";
import {
  getPool,
  updatePool,
  updatePoolEntp,
  deletePool,
  testPoolK8sConnection,
} from "@/server/domains/system/pool.service";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

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

/** 编辑/启停（ENTP-006；MULTI_POOL 门控；默认池禁用保护）。 */
export const PATCH = withSystemPerm("ENTP_POOL:UPDATE")(async (ctx, req, seg) => {
  try {
    await assertEntpEnabled("MULTI_POOL");
    const { poolId } = await (seg as { params: Promise<{ poolId: string }> }).params;
    const input = zodParse(poolEntpUpdateSchema, await req.json());
    const updated = await updatePoolEntp(poolId, input);
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: input.status
        ? `pool.${input.status === "DISABLED" ? "disable" : "enable"}`
        : "pool.update",
      objectType: "resource_pool",
      objectId: poolId,
      detail: input,
    });
    void flushAudit();
    return NextResponse.json(ok(updated));
  } catch (err) {
    return toResponse(err);
  }
});

/** 删除（ENTP-006；默认池/有历史任务保护；MULTI_POOL 门控）。 */
export const DELETE = withSystemPerm("ENTP_POOL:DELETE")(async (ctx, _req, seg) => {
  try {
    await assertEntpEnabled("MULTI_POOL");
    const { poolId } = await (seg as { params: Promise<{ poolId: string }> }).params;
    const result = await deletePool(poolId);
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: "pool.delete",
      objectType: "resource_pool",
      objectId: poolId,
      detail: {},
    });
    void flushAudit();
    return NextResponse.json(ok(result));
  } catch (err) {
    return toResponse(err);
  }
});
