import { toResponse, okResponse, withSystemPerm } from "@/server/guard";
import { auditLogQuerySchema } from "@rabbit/shared";
import { queryAuditLogs } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

/** SYS-008：系统日志（全量；SYSTEM_AUDIT:READ）。 */
export const GET = withSystemPerm("SYSTEM_AUDIT:READ")(async (_ctx, req) => {
  try {
    const url = new URL(req.url);
    const query = auditLogQuerySchema.parse(Object.fromEntries(url.searchParams.entries()));
    return okResponse(await queryAuditLogs(query, { kind: "system" }));
  } catch (err) {
    return toResponse(err);
  }
});
