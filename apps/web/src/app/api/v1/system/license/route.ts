import { NextResponse } from "next/server";
import { ok, licenseAddSchema } from "@rabbit/shared";
import { withSystemPerm, toResponse, zodParse } from "@/server/guard";
import { addLicense, getLicenseState, removeLicense } from "@/server/domains/entp/license.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

/** 授权状态（管理面，含 payload 明细）。 */
export const GET = withSystemPerm("SYSTEM_LICENSE:READ")(async () => {
  try {
    return NextResponse.json(ok(await getLicenseState()));
  } catch (err) {
    return toResponse(err);
  }
});

/** 添加/更换 License（覆盖模型；三重校验失败 422 90002-90004）。 */
export const POST = withSystemPerm("SYSTEM_LICENSE:UPDATE")(async (ctx, req) => {
  try {
    const input = zodParse(licenseAddSchema, await req.json());
    const state = await addLicense(input.code);
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: "license.add",
      objectType: "system_license",
      objectId: "license",
      detail: { lic: state.lic, expiresAt: state.expiresAt },
    });
    void flushAudit();
    return NextResponse.json(ok(state));
  } catch (err) {
    return toResponse(err);
  }
});

/** 移除 License（回社区版）。 */
export const DELETE = withSystemPerm("SYSTEM_LICENSE:UPDATE")(async (ctx) => {
  try {
    const state = await removeLicense();
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: "license.remove",
      objectType: "system_license",
      objectId: "license",
      detail: {},
    });
    void flushAudit();
    return NextResponse.json(ok(state));
  } catch (err) {
    return toResponse(err);
  }
});
