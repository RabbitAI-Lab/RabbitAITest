import { toResponse, okResponse, withOrgScope } from '@/server/guard';
import { projectUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/project/project.service';

export const GET = withOrgScope(async (ctx, req) => {
  try {
    ctx.requirePerm('ORG_PROJECT:READ');
    const url = new URL(req.url);
    return okResponse(await svc.listOrgProjects(ctx.orgId, { deleted: url.searchParams.get('deleted') ?? undefined, keyword: url.searchParams.get('keyword') ?? undefined }));
  } catch (err) { return toResponse(err); }
});

export const POST = withOrgScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm('ORG_PROJECT:CREATE');
    const body = projectUpsertSchema.parse(await req.json());
    return okResponse(await svc.createOrgProject(ctx.orgId, ctx.userId, body), 201);
  } catch (err) { return toResponse(err); }
});
