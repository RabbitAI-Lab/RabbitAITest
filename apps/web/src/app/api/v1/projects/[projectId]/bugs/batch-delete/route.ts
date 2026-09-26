import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/bug/bug.service';

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_BUG:DELETE');
    ctx.requireWritable();
    const body = (await req.json()) as { ids?: string[] };
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return okResponse({ ok: false, message: '缺少 ids' }, 422);
    }
    return okResponse(await svc.batchDeleteBugs(ctx.projectId, body.ids));
  } catch (err) { return toResponse(err); }
});
