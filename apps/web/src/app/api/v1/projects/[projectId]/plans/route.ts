import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import { planUpsertSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/plan/plan.service";

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_PLAN:READ");
    const url = new URL(req.url);
    return okResponse(
      await svc.listPlans(ctx.projectId, {
        keyword: url.searchParams.get("keyword") ?? undefined,
        archived: url.searchParams.get("archived") ?? undefined,
        page: Number(url.searchParams.get("page") ?? 1),
        pageSize: Number(url.searchParams.get("pageSize") ?? 20),
      }),
    );
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm("PROJECT_PLAN:CREATE");
    ctx.requireWritable();
    const body = planUpsertSchema.parse(await req.json());
    return okResponse(await svc.createPlan(ctx.projectId, ctx.userId, body), 201);
  } catch (err) {
    return toResponse(err);
  }
});
