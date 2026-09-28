import { withProjectScope, toResponse, okResponse, zodParse } from "@/server/guard";
import { pointsReorderSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/plan/plan-points.service";

/** S4 PLAN-002：同级批量重排。 */
export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_PLAN:UPDATE");
    ctx.requireWritable();
    const { planId } = await (seg as { params: Promise<{ planId: string }> }).params;
    const body = zodParse(pointsReorderSchema, await req.json());
    return okResponse(await svc.reorderPoints(ctx.projectId, planId, body.orderedIds));
  } catch (err) {
    return toResponse(err);
  }
});
