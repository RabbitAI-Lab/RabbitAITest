import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import { caseListQueryV2Schema, caseCreateV2Schema } from "@rabbit/shared";
import * as svc from "@/server/domains/case/caseV2.service";

export const GET = withProjectScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE:READ");
    const q = caseListQueryV2Schema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return okResponse(await svc.listCasesV2(ctx.projectId, q, ctx.userId));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE:CREATE");
    ctx.requireWritable();
    const body = caseCreateV2Schema.parse(await req.json());
    return okResponse(await svc.createCaseV2(ctx.projectId, ctx.orgId, ctx.userId, body), 201);
  } catch (err) {
    return toResponse(err);
  }
});
