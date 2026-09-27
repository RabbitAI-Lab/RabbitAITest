import { okResponse, toResponse, withProjectScope, zodParse } from "@/server/guard";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { z } from "zod";
import * as svc from "@/server/domains/bug/bug.service";

export const runtime = "nodejs";

const batchIdsSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });

/** S5 BUG-002：回收站批量恢复。 */
export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_BUG:UPDATE");
    ctx.requireWritable();
    const body = zodParse(batchIdsSchema, await req.json());
    const r = await svc.batchRestoreBugs(ctx.projectId, body.ids);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "bug.batch_restore",
      objectType: "bug",
      objectId: body.ids.join(","),
      detail: { affected: r.affected },
    });
    void flushAudit();
    return okResponse(r);
  } catch (err) {
    return toResponse(err);
  }
});
