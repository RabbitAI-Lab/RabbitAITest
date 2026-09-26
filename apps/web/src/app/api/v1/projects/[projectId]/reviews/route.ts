import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import { reviewUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/review/review.service';

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_CASE_REVIEW:READ');
    const url = new URL(req.url);
    return okResponse(await svc.listReviews(ctx.projectId, ctx.userId, {
      view: url.searchParams.get('view') ?? undefined,
      keyword: url.searchParams.get('keyword') ?? undefined,
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 20),
    }));
  } catch (err) { return toResponse(err); }
});

export const POST = withProjectScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE_REVIEW:UPDATE');
    ctx.requireWritable();
    const body = reviewUpsertSchema.parse(await req.json());
    return okResponse(await svc.createReview(ctx.projectId, ctx.userId, body), 201);
  } catch (err) { return toResponse(err); }
});
