import { toResponse, okResponse, withProjectScopeAllowDeleted } from '@/server/guard';
import * as svc from '@/server/domains/project/project.service';

export const POST = withProjectScopeAllowDeleted(async (ctx) => {
  try {
    ctx.requirePerm('ORG_PROJECT:DELETE');
    return okResponse(await svc.restoreProject(ctx.projectId, ctx.userId));
  } catch (err) { return toResponse(err); }
});
