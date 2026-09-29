import { toResponse, okResponse, withOrgScope } from "@/server/guard";
import { templateUpsertSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/project/template.service";

export const GET = withOrgScope(async (ctx, req) => {
  try {
    ctx.requirePerm("ORG_TEMPLATE:READ");
    return okResponse(
      await svc.listTemplates(
        ctx.orgId,
        null,
        new URL(req.url).searchParams.get("scene") ?? undefined,
      ),
    );
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withOrgScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm("ORG_TEMPLATE:UPDATE");
    const body = templateUpsertSchema.parse(await req.json());
    return okResponse(await svc.createTemplate(ctx.orgId, null, ctx.userId, body), 201);
  } catch (err) {
    return toResponse(err);
  }
});
