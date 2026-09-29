import { NextResponse } from "next/server";
import { ok, authSourceUpsertSchema } from "@rabbit/shared";
import { withSystemPerm, toResponse, zodParse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import * as svc from "@/server/domains/entp/sso.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

export const GET = withSystemPerm("ENTP_SSO:READ")(async () => {
  try {
    return NextResponse.json(ok(await svc.listSources()));
  } catch (err) {
    return toResponse(err);
  }
});

/** 新建认证源（ENTP-002；SSO 特性门控；SAML 占位拒绝）。 */
export const POST = withSystemPerm("ENTP_SSO:CREATE")(async (ctx, req) => {
  try {
    await assertEntpEnabled("SSO");
    const input = zodParse(authSourceUpsertSchema, await req.json());
    const created = await svc.createSource(input);
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: "sso.source.create",
      objectType: "auth_source",
      objectId: created.id,
      detail: { type: input.type, name: input.name },
    });
    void flushAudit();
    return NextResponse.json(ok(created), { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
});
