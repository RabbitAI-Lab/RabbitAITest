import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import { linkCaseBugSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/case/caseDetail.service';

export const GET = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_BUG:READ');
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    return okResponse(await svc.caseBugs(ctx.projectId, caseId));
  } catch (err) { return toResponse(err); }
});

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_BUG:UPDATE');
    ctx.requireWritable();
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    const body = linkCaseBugSchema.parse(await req.json());
    return okResponse(await svc.linkCaseBug(ctx.projectId, caseId, body.bugId));
  } catch (err) { return toResponse(err); }
});
