import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/dash/dash.service';

export const GET = withProjectScope(async (ctx, req) => {
  try {
    const url = new URL(req.url);
    const range = url.searchParams.get('range') ?? '7d';
    const parsed = svc.parseRange(range, url.searchParams.get('from') ?? undefined, url.searchParams.get('to') ?? undefined);
    if (Number.isNaN(parsed.from.getTime()) || Number.isNaN(parsed.to.getTime())) {
      return okResponse({ ok: false, message: '非法时间区间' }, 422);
    }
    return okResponse(await svc.overview(ctx.projectId, ctx.orgId, parsed));
  } catch (err) { return toResponse(err); }
});
