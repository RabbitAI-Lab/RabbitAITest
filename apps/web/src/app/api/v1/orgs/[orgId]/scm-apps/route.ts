/** SCM-001：组织视角的 OAuth 应用解析视图（source=org|system|none；clientSecret 只回 hasSecret）。 */
import { toResponse, okResponse, withOrgScope } from "@/server/guard";
import * as svc from "@/server/domains/scm/scm-app.service";

export const GET = withOrgScope(async (ctx) => {
  try {
    ctx.requirePerm("ORG_INTEGRATION:READ");
    return okResponse(await svc.listScmApps(ctx.orgId));
  } catch (err) {
    return toResponse(err);
  }
});
