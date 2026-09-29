import { withOrgScope, toResponse, okResponse } from "@/server/guard";
import { orgMemberQuerySchema } from "@rabbit/shared";
import * as svc from "@/server/domains/project/project.service";

export const GET = withOrgScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm("ORG_MEMBER:READ");
    const q = orgMemberQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return okResponse(await svc.listOrgMembers(ctx.orgId, q));
  } catch (err) {
    return toResponse(err);
  }
});
