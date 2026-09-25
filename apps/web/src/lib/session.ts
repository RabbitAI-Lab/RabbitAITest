import { getIronSession, type IronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { config } from '@rabbit/shared';

export interface SessionContent {
  userId?: string;
  email?: string;
}

export type AppSession = IronSession<SessionContent>;

export async function getSession(): Promise<AppSession> {
  return getIronSession<SessionContent>(await cookies(), {
    cookieName: 'ras',
    password: config.sessionSecret,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      // Secure cookie 开关：反代卸载 TLS / 内网 http（JMeter、CI）场景需显式关闭
      secure: process.env.SESSION_COOKIE_SECURE
        ? process.env.SESSION_COOKIE_SECURE === 'true'
        : process.env.NODE_ENV === 'production',
    },
  });
}
