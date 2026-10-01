/** SCM-001：组织内授权账号列表（org 成员可见——项目绑定选号用；含授权人展示名）。 */
import { toResponse, okResponse, withOrgScope } from "@/server/guard";
import { listScmAccounts } from "@/server/domains/scm/scm-oauth.service";

export const GET = withOrgScope(async (ctx) => {
  try {
    return okResponse(await listScmAccounts(ctx.orgId));
  } catch (err) {
    return toResponse(err);
  }
});
