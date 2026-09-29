import { NextResponse } from "next/server";
import { ok, departmentUpsertSchema } from "@rabbit/shared";
import { withOrgScope, toResponse, zodParse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import * as svc from "@/server/domains/entp/department.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

export const GET = withOrgScope(async (ctx, _req, _seg) => {
  try {
    ctx.requirePerm("ORG_DEPARTMENT:READ");
    await assertEntpEnabled("USER_SCALE");
    return NextResponse.json(ok(await svc.listTree(ctx.orgId)));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withOrgScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm("ORG_DEPARTMENT:CREATE");
    await assertEntpEnabled("USER_SCALE");
    const input = zodParse(departmentUpsertSchema, await req.json());
    const created = await svc.createDepartment(ctx.orgId, input);
    recordAudit({
      userId: ctx.userId,
      scope: "org",
      projectId: null,
      action: "department.create",
      objectType: "department",
      objectId: created.id,
      detail: { name: input.name, parentId: input.parentId ?? null },
    });
    void flushAudit();
    return NextResponse.json(ok(created), { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
});
