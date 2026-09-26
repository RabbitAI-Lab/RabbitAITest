import { withProjectScope, toResponse, okResponse } from '@/server/guard';
import { linkBugCaseSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/bug/bug.service';

export const GET = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_BUG:READ');
    const { bugId } = await (seg as { params: Promise<{ bugId: string }> }).params;
    return okResponse(await svc.listBugCases(ctx.projectId, bugId));
  } catch (err) { return toResponse(err); }
});

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_BUG:UPDATE');
    ctx.requireWritable();
    const { bugId } = await (seg as { params: Promise<{ bugId: string }> }).params;
    const body = linkBugCaseSchema.parse(await req.json());
    return okResponse(await svc.linkBugCase(ctx.projectId, bugId, body.caseId));
  } catch (err) { return toResponse(err); }
});
