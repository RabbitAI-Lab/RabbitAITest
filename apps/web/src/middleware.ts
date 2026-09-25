import { NextResponse, type NextRequest } from 'next/server';
import { getIronSession } from 'iron-session';
import { config as appConfig } from '@rabbit/shared';
import type { SessionContent } from '@/lib/session';

/** SYS-002：前端路由守卫（未登录 302 /login?next=；已登录访问 login/register 跳 /）。 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // 守卫只读会话：RequestCookies 适配 iron-session CookieStore（set 为空实现）
  const cookieStore = {
    get: (name: string) => {
      const c = req.cookies.get(name);
      return c ? { name, value: c.value } : undefined;
    },
    set: () => {},
  };
  const session = await getIronSession<SessionContent>(cookieStore, {
    cookieName: 'ras',
    password: appConfig.sessionSecret,
  });
  const authed = Boolean(session.userId);
  const isAuthPage = pathname === '/login' || pathname === '/register';
  if (!authed && !isAuthPage) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  if (authed && isAuthPage) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/cases/:path*', '/debug/:path*', '/reports/:path*', '/login', '/register'],
};
