import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withSystemPerm, toResponse } from "@/server/guard";
import { assertEntpEnabled } from "@/server/domains/entp/license.service";
import { testConnection } from "@/server/domains/entp/sso.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ authId: string }> };

/** 测试连接：LDAP bind+search / HTTP 端点探活（ENTP-002）。 */
export const POST = withSystemPerm("ENTP_SSO:UPDATE")(async (_ctx, _req, seg) => {
  try {
    await assertEntpEnabled("SSO");
    const { authId } = await (seg as Seg).params;
    return NextResponse.json(ok(await testConnection(authId)));
  } catch (err) {
    return toResponse(err);
  }
});
