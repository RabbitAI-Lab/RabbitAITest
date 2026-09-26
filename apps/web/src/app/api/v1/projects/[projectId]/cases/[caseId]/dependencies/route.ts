import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import { dependencyUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/case/caseDetail.service';

export const GET = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE:READ');
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    return okResponse(await svc.listDependencies(ctx.projectId, caseId));
  } catch (err) { return toResponse(err); }
});

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE:UPDATE');
    ctx.requireWritable();
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    const body = dependencyUpsertSchema.parse(await req.json());
    return okResponse(await svc.addDependency(ctx.projectId, body.preCaseId === caseId ? body.preCaseId : body.preCaseId, body.postCaseId === caseId ? caseId : body.postCaseId), 201);
  } catch (err) { return toResponse(err); }
});
