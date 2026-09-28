import { NextResponse } from "next/server";
import { ok, poolCreateSchema } from "@rabbit/shared";
import { withSystemPerm, toResponse, zodParse } from "@/server/guard";
import { listPools, createPool } from "@/server/domains/system/pool.service";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

export const GET = withSystemPerm("SYSTEM_POOL:READ")(async () => {
  try {
    return NextResponse.json(ok(await listPools()));
  } catch (err) {
    return toResponse(err);
  }
});

/** 新建资源池（ENTP-006；MULTI_POOL 门控）。 */
export const POST = withSystemPerm("ENTP_POOL:CREATE")(async (ctx, req) => {
  try {
    await assertEntpEnabled("MULTI_POOL");
    const input = zodParse(poolCreateSchema, await req.json());
    const created = await createPool(input);
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: "pool.create",
      objectType: "resource_pool",
      objectId: created.id,
      detail: { name: input.name, type: input.type, maxConcurrency: input.maxConcurrency },
    });
    void flushAudit();
    return NextResponse.json(ok(created), { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
});
