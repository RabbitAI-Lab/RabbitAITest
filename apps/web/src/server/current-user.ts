import { cache } from "react";
import { headers } from "next/headers";
import { getSession } from "@/lib/session";
import { prisma } from "@rabbit/db";
import { verifyAccessToken } from "@/server/domains/api/oauth.service";
import type { OAuthScope } from "@rabbit/shared";

export interface AuthIdentity {
  userId: string;
  email?: string;
  /** SYS-009：Token 通道声明的 scope（null=session/APIKEY 通道，不受 scope 约束） */
  tokenScope: OAuthScope[] | null;
  kind: "session" | "token";
}

/**
 * 请求级身份解析（统一认证协商，SYS-002 + SYS-009 §2.4）：
 * ① session cookie（禁用/软删用户立即失效 → 401，SYS-004 §2）
 * ② Authorization: Bearer rat_*（OAuth Token 通道——OAuthGrant ACTIVE 且未过期且用户 ACTIVE）
 * React cache 保证单请求内只查一次；getActiveUserId 为薄封装（既有调用点零改动）。
 */
export const getAuthIdentity = cache(async (): Promise<AuthIdentity | null> => {
  const session = await getSession();
  if (session.userId) {
    const user = await prisma.user.findFirst({
      where: { id: session.userId, status: "ACTIVE", deletedAt: null },
      select: { id: true, email: true },
    });
    if (user) {
      session.email = user.email;
      return { userId: user.id, email: user.email, tokenScope: null, kind: "session" };
    }
  }
  const authorization = (await headers()).get("authorization");
  if (authorization?.startsWith("Bearer rat_")) {
    const verified = await verifyAccessToken(authorization.slice("Bearer ".length));
    if (verified) {
      return {
        userId: verified.userId,
        tokenScope: verified.scope,
        kind: "token",
      };
    }
  }
  return null;
});

export const getActiveUserId = cache(async (): Promise<string | null> => {
  return (await getAuthIdentity())?.userId ?? null;
});

/** SYS-009：Token 通道 scope（session/APIKEY 返回 null——不受约束）。守卫层断言用。 */
export async function getTokenScope(): Promise<OAuthScope[] | null> {
  return (await getAuthIdentity())?.tokenScope ?? null;
}
