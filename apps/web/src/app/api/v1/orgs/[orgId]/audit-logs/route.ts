import { toResponse, okResponse, withOrgScope } from "@/server/guard";
import { auditLogQuerySchema } from "@rabbit/shared";
import { queryAuditLogs } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

/** SYS-008：组织日志（本组织含下属项目；ORG_AUDIT:READ）。 */
export const GET = withOrgScope(async (ctx, req) => {
  try {
    ctx.requirePerm("ORG_AUDIT:READ");
    const url = new URL(req.url);
    const query = auditLogQuerySchema.parse(Object.fromEntries(url.searchParams.entries()));
    return okResponse(await queryAuditLogs(query, { kind: "org", orgId: ctx.orgId }));
  } catch (err) {
    return toResponse(err);
  }
});
