import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import { templateUpsertSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/project/template.service";

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_TEMPLATE:READ");
    return okResponse(
      await svc.listTemplates(
        ctx.orgId,
        ctx.projectId,
        new URL(req.url).searchParams.get("scene") ?? undefined,
      ),
    );
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm("PROJECT_TEMPLATE:UPDATE");
    ctx.requireWritable();
    const body = templateUpsertSchema.parse(await req.json());
    return okResponse(await svc.createTemplate(ctx.orgId, ctx.projectId, ctx.userId, body), 201);
  } catch (err) {
    return toResponse(err);
  }
});
