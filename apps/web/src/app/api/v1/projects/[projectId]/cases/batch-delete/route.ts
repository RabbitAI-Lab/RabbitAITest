import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import { caseBatchSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/case/caseV2.service";

export const POST = withProjectScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE:DELETE");
    ctx.requireWritable();
    const body = caseBatchSchema.parse(await req.json());
    return okResponse(await svc.batchCases(ctx.projectId, ctx.orgId, ctx.userId, "delete", body));
  } catch (err) {
    return toResponse(err);
  }
});
