import { NextResponse } from "next/server";
import { ok, authSourceUpsertSchema } from "@rabbit/shared";
import { withSystemPerm, toResponse, zodParse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import * as svc from "@/server/domains/entp/sso.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ authId: string }> };

export const PATCH = withSystemPerm("ENTP_SSO:UPDATE")(async (ctx, req, seg) => {
  try {
    await assertEntpEnabled("SSO");
    const { authId } = await (seg as Seg).params;
    const input = zodParse(authSourceUpsertSchema, await req.json());
    await svc.updateSource(authId, input);
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: "sso.source.update",
      objectType: "auth_source",
      objectId: authId,
      detail: { type: input.type, name: input.name, enabled: input.enabled },
    });
    void flushAudit();
    return NextResponse.json(ok({ id: authId }));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withSystemPerm("ENTP_SSO:DELETE")(async (ctx, _req, seg) => {
  try {
    await assertEntpEnabled("SSO");
    const { authId } = await (seg as Seg).params;
    const result = await svc.deleteSource(authId);
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: "sso.source.delete",
      objectType: "auth_source",
      objectId: authId,
      detail: {},
    });
    void flushAudit();
    return NextResponse.json(ok(result));
  } catch (err) {
    return toResponse(err);
  }
});
