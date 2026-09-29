import { NextResponse } from "next/server";
import { ok, orgUpdateSchema } from "@rabbit/shared";
import { withSystemPerm, toResponse, zodParse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import * as svc from "@/server/domains/entp/org-admin.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ orgId: string }> };

/** 编辑/结束/恢复（MULTI_ORG 门控）。 */
export const PATCH = withSystemPerm("ENTP_ORG:UPDATE")(async (ctx, req, seg) => {
  try {
    await assertEntpEnabled("MULTI_ORG");
    const { orgId } = await (seg as Seg).params;
    const input = zodParse(orgUpdateSchema, await req.json());
    await svc.updateOrg(orgId, input);
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action:
        input.status === "ENDED"
          ? "org.end"
          : input.status === "ACTIVE"
            ? "org.restore"
            : "org.update",
      objectType: "organization",
      objectId: orgId,
      detail: input,
    });
    void flushAudit();
    return NextResponse.json(ok({ id: orgId }));
  } catch (err) {
    return toResponse(err);
  }
});

/** 删除组织（级联项目数据；needConfirm=true 二次确认；MULTI_ORG 门控）。 */
export const DELETE = withSystemPerm("ENTP_ORG:DELETE")(async (ctx, req, seg) => {
  try {
    await assertEntpEnabled("MULTI_ORG");
    const { orgId } = await (seg as Seg).params;
    const url = new URL(req.url);
    const needConfirm = url.searchParams.get("needConfirm") === "true";
    const result = await svc.deleteOrg(orgId, needConfirm);
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: "org.delete",
      objectType: "organization",
      objectId: orgId,
      detail: { deletedProjects: result.deletedProjects },
    });
    void flushAudit();
    return NextResponse.json(ok(result));
  } catch (err) {
    return toResponse(err);
  }
});
