import { NextResponse } from "next/server";
import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import { auditLogQuerySchema } from "@rabbit/shared";
import { queryAuditLogs } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

/** SYS-008：项目日志（本项目；PROJECT_AUDIT:READ）。 */
export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_AUDIT:READ");
    const url = new URL(req.url);
    const pp = auditLogQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!pp.success) {
      return NextResponse.json(
        { code: 20422, message: pp.error.issues[0]?.message ?? "参数校验失败", data: null },
        { status: 422 },
      );
    }
    const query = pp.data;
    return okResponse(await queryAuditLogs(query, { kind: "project", projectId: ctx.projectId }));
  } catch (err) {
    return toResponse(err);
  }
});
