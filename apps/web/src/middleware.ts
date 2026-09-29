import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { config as appConfig } from "@rabbit/shared";
import { csrfRejected } from "@/server/csrf";
import type { SessionContent } from "@/lib/session";

/**
 * SYS-002：前端路由守卫（未登录 302 /login?next=；已登录访问 login/register 跳 /）。
 * INFRA-004：reqId 生成/透传（x-request-id 请求头注入 + X-Request-Id 响应头）。
 * QA-002：CSRF Origin 校验——非幂等 + 会话 cookie 且 Origin/Referer 与 host 不同源 → 403 10013。
 *   缺失放行：第一层防护为 SameSite=Lax cookie（跨站 POST 不携带会话 cookie），Origin 为纵深防御
 *   第二层；缺失放行兼容非浏览器客户端（JMeter/OpenAPI SDK/CI 脚本）。Authorization 头（APIKEY）豁免。
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  const reqId =
    req.headers.get("x-request-id")?.slice(0, 64) ||
    crypto.randomUUID().replace(/-/g, "").slice(0, 12);

  if (pathname.startsWith("/api/")) {
    if (
      csrfRejected({
        method: req.method,
        hasAuthorization: req.headers.has("authorization"),
        hasSessionCookie: req.cookies.has("ras"),
        origin: req.headers.get("origin"),
        referer: req.headers.get("referer"),
        host: req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
      })
    ) {
      return NextResponse.json(
        { code: 10013, message: "跨站请求被拒绝（Origin 校验失败）", data: null },
        { status: 403, headers: { "x-request-id": reqId } },
      );
    }
    // API 面零改写直通（请求头注入曾致 SSE 流响应体 CDP 不可读 + 全量 e2e 时序抖动——reqId
    // 由 guard 入口兜底生成，X-Request-Id 响应头由 guard 出口回写；此处仅保留 CSRF 拦截）
    return NextResponse.next();
  }

  // 守卫只读会话：RequestCookies 适配 iron-session CookieStore（set 为空实现）
  const cookieStore = {
    get: (name: string) => {
      const c = req.cookies.get(name);
      return c ? { name, value: c.value } : undefined;
    },
    set: () => {},
  };
  const session = await getIronSession<SessionContent>(cookieStore, {
    cookieName: "ras",
    password: appConfig.sessionSecret,
  });
  const authed = Boolean(session.userId);
  const isAuthPage = pathname === "/login" || pathname === "/register";
  let res: NextResponse;
  if (!authed && !isAuthPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    res = NextResponse.redirect(url);
  } else if (authed && isAuthPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    res = NextResponse.redirect(url);
  } else {
    const headers = new Headers(req.headers);
    headers.set("x-request-id", reqId);
    res = NextResponse.next({ request: { headers } });
  }
  res.headers.set("x-request-id", reqId);
  return res;
}

export const config = {
  matcher: [
    "/",
    "/cases/:path*",
    "/debug/:path*",
    "/reports/:path*",
    "/login",
    "/register",
    "/api/:path*",
  ],
};
