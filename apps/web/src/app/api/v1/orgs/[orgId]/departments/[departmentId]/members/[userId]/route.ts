import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withOrgScope, toResponse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import { removeDepartmentMember } from "@/server/domains/entp/department.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ departmentId: string; userId: string }> };

export const DELETE = withOrgScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("ORG_DEPARTMENT:UPDATE");
    await assertEntpEnabled("USER_SCALE");
    const { departmentId, userId } = await (seg as Seg).params;
    return NextResponse.json(ok(await removeDepartmentMember(ctx.orgId, departmentId, userId)));
  } catch (err) {
    return toResponse(err);
  }
});
