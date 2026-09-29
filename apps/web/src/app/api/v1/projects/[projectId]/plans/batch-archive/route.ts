import { withProjectScope, toResponse, okResponse, zodParse } from "@/server/guard";
import { plansBatchArchiveSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/plan/plan-group.service";

/** S4 PLAN-004：批量归档/恢复（计划与组混选；组级联成员）。 */
export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_PLAN:UPDATE");
    ctx.requireWritable();
    const body = zodParse(plansBatchArchiveSchema, await req.json());
    return okResponse(await svc.batchArchivePlans(ctx.projectId, body.ids, body.archived));
  } catch (err) {
    return toResponse(err);
  }
});
