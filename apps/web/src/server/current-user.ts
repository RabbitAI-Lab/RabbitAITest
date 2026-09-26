import { cache } from "react";
import { getSession } from "@/lib/session";
import { prisma } from "@rabbit/db";

/**
 * 请求级当前用户解析（SYS-004 §2：禁用/软删用户的会话立即失效 → 401）。
 * React cache 保证单请求内只查一次。
 */
export const getActiveUserId = cache(async (): Promise<string | null> => {
  const session = await getSession();
  if (!session.userId) return null;
  const user = await prisma.user.findFirst({
    where: { id: session.userId, status: "ACTIVE", deletedAt: null },
    select: { id: true, email: true },
  });
  if (!user) return null;
  session.email = user.email;
  return user.id;
});
