import { NextResponse } from "next/server";
import { ok, departmentUpsertSchema } from "@rabbit/shared";
import { withOrgScope, toResponse, zodParse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import * as svc from "@/server/domains/entp/department.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ departmentId: string }> };

export const PATCH = withOrgScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("ORG_DEPARTMENT:UPDATE");
    await assertEntpEnabled("USER_SCALE");
    const { departmentId } = await (seg as Seg).params;
    const input = zodParse(departmentUpsertSchema, await req.json());
    await svc.updateDepartment(ctx.orgId, departmentId, input);
    recordAudit({
      userId: ctx.userId,
      scope: "org",
      projectId: null,
      action: "department.update",
      objectType: "department",
      objectId: departmentId,
      detail: input,
    });
    void flushAudit();
    return NextResponse.json(ok({ id: departmentId }));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withOrgScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("ORG_DEPARTMENT:DELETE");
    await assertEntpEnabled("USER_SCALE");
    const { departmentId } = await (seg as Seg).params;
    await svc.deleteDepartment(ctx.orgId, departmentId);
    recordAudit({
      userId: ctx.userId,
      scope: "org",
      projectId: null,
      action: "department.delete",
      objectType: "department",
      objectId: departmentId,
      detail: {},
    });
    void flushAudit();
    return NextResponse.json(ok({ id: departmentId }));
  } catch (err) {
    return toResponse(err);
  }
});
