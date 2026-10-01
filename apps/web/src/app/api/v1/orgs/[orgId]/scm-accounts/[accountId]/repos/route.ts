/** SCM-001：OAuth 选仓——授权账号可见仓库列表（平台侧聚合分页 + keyword 过滤，{total,items} 信封）。 */
import { toResponse, okResponse, withOrgScope, zodParse } from "@/server/guard";
import { scmAccountReposQuerySchema } from "@rabbit/shared";
import { listAccountRepos } from "@/server/domains/scm/scm-oauth.service";

type Seg = { params: Promise<{ accountId: string }> };

export const GET = withOrgScope(async (ctx, req, seg) => {
  try {
    const { accountId } = await (seg as Seg).params;
    const url = new URL(req.url);
    const q = zodParse(scmAccountReposQuerySchema, {
      keyword: url.searchParams.get("keyword") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    return okResponse(await listAccountRepos(ctx.orgId, accountId, q));
  } catch (err) {
    return toResponse(err);
  }
});
