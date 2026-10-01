/**
 * SCM-001 OAuth 回调（未登录可达，事实源为一次性 state）：state 校验 → 换 token → 账号入库
 * → 302 回前端 /settings/code-repos?oauth={provider}&result=ok|fail（失败带短消息，不泄平台原始响应）。
 */
import { NextResponse } from "next/server";
import { toResponse, zodParse } from "@/server/guard";
import { handleScmCallback } from "@/server/domains/scm/scm-oauth.service";
import { scmOauthProviderSchema } from "@rabbit/shared";

export const runtime = "nodejs";

type Seg = { params: Promise<{ orgId: string; provider: string }> };

export async function GET(req: Request, seg: Seg): Promise<NextResponse> {
  try {
    const { orgId, provider } = await seg.params;
    const url = new URL(req.url);
    const back = (result: "ok" | "fail", message?: string) => {
      const q = new URLSearchParams({ oauth: provider, result });
      if (message) q.set("message", message.slice(0, 120));
      return NextResponse.redirect(new URL(`/settings/code-repos?${q}`, url.origin), 302);
    };
    let parsedProvider: "github" | "gitee" | "gitlab";
    try {
      parsedProvider = zodParse(scmOauthProviderSchema, provider);
    } catch {
      return back("fail", "不支持的平台");
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code) return back("fail", "平台未返回授权码");
    try {
      await handleScmCallback(orgId, parsedProvider, code, state ?? "");
      return back("ok");
    } catch (err) {
      const message = err instanceof Error ? err.message : "授权失败";
      return back("fail", message);
    }
  } catch (err) {
    return toResponse(err);
  }
}
