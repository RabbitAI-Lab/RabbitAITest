import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/project/template.service';

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_TEMPLATE:READ');
    const templateId = new URL(req.url).searchParams.get('templateId') ?? undefined;
    return okResponse(await svc.getWorkflow(ctx.orgId, ctx.projectId, templateId));
  } catch (err) { return toResponse(err); }
});
