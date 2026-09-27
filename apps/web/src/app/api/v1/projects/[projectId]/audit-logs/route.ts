import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import { auditLogQuerySchema } from "@rabbit/shared";
import { queryAuditLogs } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

/** SYS-008：项目日志（本项目；PROJECT_AUDIT:READ）。 */
export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_AUDIT:READ");
    const url = new URL(req.url);
    const query = auditLogQuerySchema.parse(Object.fromEntries(url.searchParams.entries()));
    return okResponse(await queryAuditLogs(query, { kind: "project", projectId: ctx.projectId }));
  } catch (err) {
    return toResponse(err);
  }
});
