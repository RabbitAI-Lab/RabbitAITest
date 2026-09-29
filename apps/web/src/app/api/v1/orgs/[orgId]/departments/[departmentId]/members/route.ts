import { NextResponse } from "next/server";
import { ok, departmentMemberAddSchema } from "@rabbit/shared";
import { withOrgScope, toResponse, zodParse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import * as svc from "@/server/domains/entp/department.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ departmentId: string }> };

export const GET = withOrgScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("ORG_DEPARTMENT:READ");
    await assertEntpEnabled("USER_SCALE");
    const { departmentId } = await (seg as Seg).params;
    return NextResponse.json(ok(await svc.listDepartmentMembers(ctx.orgId, departmentId)));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withOrgScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("ORG_DEPARTMENT:UPDATE");
    await assertEntpEnabled("USER_SCALE");
    const { departmentId } = await (seg as Seg).params;
    const input = zodParse(departmentMemberAddSchema, await req.json());
    const result = await svc.addDepartmentMembers(ctx.orgId, departmentId, input.userIds);
    recordAudit({
      userId: ctx.userId,
      scope: "org",
      projectId: null,
      action: "department.member.add",
      objectType: "department",
      objectId: departmentId,
      detail: { count: input.userIds.length },
    });
    void flushAudit();
    return NextResponse.json(ok(result), { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
});
