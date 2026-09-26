import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/dash/dash.service';

export const GET = withProjectScope(async (ctx, req) => {
  try {
    const url = new URL(req.url);
    return okResponse(await svc.created(ctx.projectId, url.searchParams.get('kind') ?? 'case', Number(url.searchParams.get('page') ?? 1), Number(url.searchParams.get('pageSize') ?? 20)));
  } catch (err) { return toResponse(err); }
});
