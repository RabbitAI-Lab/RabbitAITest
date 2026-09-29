import { NextResponse } from "next/server";
import { ok, orgCreateSchema } from "@rabbit/shared";
import { withSystemPerm, toResponse, zodParse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import * as svc from "@/server/domains/entp/org-admin.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

export const GET = withSystemPerm("ENTP_ORG:READ")(async () => {
  try {
    return NextResponse.json(ok(await svc.listOrgs()));
  } catch (err) {
    return toResponse(err);
  }
});

/** 创建组织（MULTI_ORG 门控）。 */
export const POST = withSystemPerm("ENTP_ORG:CREATE")(async (ctx, req) => {
  try {
    await assertEntpEnabled("MULTI_ORG");
    const input = zodParse(orgCreateSchema, await req.json());
    const created = await svc.createOrg(ctx.userId, input);
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: "org.create",
      objectType: "organization",
      objectId: created.id,
      detail: { name: input.name, ownerEmail: input.ownerEmail },
    });
    void flushAudit();
    return NextResponse.json(ok(created), { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
});
