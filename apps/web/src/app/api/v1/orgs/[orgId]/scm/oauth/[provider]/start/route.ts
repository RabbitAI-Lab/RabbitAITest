/**
 * SCM-001 OAuth 发起：org 成员即可（个人身份授权共享给组织）→ state → 302 平台 authorize。
 * App 未配置 → 422 SCM_APP_NOT_CONFIGURED（前端引导去系统/组织配置）。
 */
import { NextResponse } from "next/server";
import { toResponse, withOrgScope, zodParse } from "@/server/guard";
import { scmOauthProviderSchema } from "@rabbit/shared";
import { buildScmAuthorizeUrl } from "@/server/domains/scm/scm-oauth.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ provider: string }> };

export const GET = withOrgScope(async (ctx, req, seg) => {
  try {
    const { provider } = await (seg as Seg).params;
    const parsedProvider = zodParse(scmOauthProviderSchema, provider);
    const origin = new URL(req.url).origin;
    const url = await buildScmAuthorizeUrl(ctx.orgId, ctx.userId, parsedProvider, origin);
    return NextResponse.redirect(url, 302);
  } catch (err) {
    return toResponse(err);
  }
});
