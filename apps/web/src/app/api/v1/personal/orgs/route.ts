import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withAuth, toResponse } from "@/server/guard";
import { listMyOrgs } from "@/server/domains/entp/org-admin.service";

export const runtime = "nodejs";

/** 本人组织列表（ENTP-001 切换器数据源；仅 ACTIVE 组织）。 */
export const GET = withAuth(async (ctx) => {
  try {
    return NextResponse.json(ok(await listMyOrgs(ctx.userId)));
  } catch (err) {
    return toResponse(err);
  }
});
