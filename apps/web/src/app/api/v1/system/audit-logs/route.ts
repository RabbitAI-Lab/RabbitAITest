import { NextResponse } from "next/server";
import { toResponse, okResponse, withSystemPerm } from "@/server/guard";
import { auditLogQuerySchema } from "@rabbit/shared";
import { queryAuditLogs } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

/** SYS-008：系统日志（全量；SYSTEM_AUDIT:READ）。 */
export const GET = withSystemPerm("SYSTEM_AUDIT:READ")(async (_ctx, req) => {
  try {
    const url = new URL(req.url);
    const pp = auditLogQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!pp.success) {
      return NextResponse.json(
        { code: 20422, message: pp.error.issues[0]?.message ?? "参数校验失败", data: null },
        { status: 422 },
      );
    }
    const query = pp.data;
    return okResponse(await queryAuditLogs(query, { kind: "system" }));
  } catch (err) {
    return toResponse(err);
  }
});
