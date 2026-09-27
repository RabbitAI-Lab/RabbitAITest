import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withSystemPerm, toResponse } from "@/server/guard";
import { listPools } from "@/server/domains/system/pool.service";

export const runtime = "nodejs";

export const GET = withSystemPerm("SYSTEM_POOL:READ")(async () => {
  try {
    return NextResponse.json(ok(await listPools()));
  } catch (err) {
    return toResponse(err);
  }
});
