/**
 * 开放 API 认证与限流（INTG-003 §2）：APIKEY 第三通道 + 每 key 10 QPS 固定窗口。
 * 数据范围=本人可见项目（越权 403 同口径）。
 */
import { NextResponse } from "next/server";
import { ErrCode, ErrMsg, fail } from "@rabbit/shared";
import { logFor, runWithLogContext } from "@rabbit/shared/logger";
import { getActiveUserId } from "@/server/current-user";
import { prisma } from "@rabbit/db";
import { verifyApiKey, parseAuthHeader } from "@/server/domains/api/apikey.service";
import { rateLimit } from "@/server/rate-limit";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

export interface OpenCtx {
  userId: string;
  akPrefix: string;
}

export function withApiKey<Args extends unknown[]>(
  handler: (ctx: OpenCtx, req: Request, ...args: Args) => Promise<NextResponse>,
) {
  return async (req: Request, ...args: Args): Promise<NextResponse> => {
    const reqId = req.headers.get("x-request-id") ?? undefined;
    const start = Date.now();
    let path = "";
    try {
      path = new URL(req.url).pathname;
    } catch {
      path = "invalid";
    }
    const finish = (res: NextResponse): NextResponse => {
      if (reqId && !res.headers.has("x-request-id")) res.headers.set("x-request-id", reqId);
      logFor("http").info(
        { method: req.method, path, status: res.status, ms: Date.now() - start },
        "http request",
      );
      return res;
    };
    return runWithLogContext({ reqId }, async () => {
      // session 通道优先协商（方便浏览器内联调试），否则 APIKEY
      const sessionUser = await getActiveUserId().catch(() => null);
      if (!sessionUser) {
        const parsed = parseAuthHeader(req.headers.get("authorization"));
        if (!parsed) {
          return finish(
            NextResponse.json(
              fail(ErrCode.UNAUTHENTICATED, "缺少 Authorization（Basic ak:sk / Bearer ak.sk）"),
              {
                status: 401,
              },
            ),
          );
        }
        try {
          const userId = await verifyApiKey(parsed.accessKey, parsed.secretKey);
          const rl = await rateLimit("open-api", parsed.accessKey.slice(0, 8), 10, 1);
          if (!rl.allowed) {
            return finish(
              NextResponse.json(
                fail(ErrCode.OPEN_RATE_LIMITED, ErrMsg[ErrCode.OPEN_RATE_LIMITED]!),
                {
                  status: 429,
                },
              ),
            );
          }
          recordAudit({
            userId,
            scope: "system",
            action: "open.exec",
            objectType: "api_call",
            detail: { akPrefix: parsed.accessKey.slice(0, 8), path },
          });
          void flushAudit();
          return finish(
            await handler({ userId, akPrefix: parsed.accessKey.slice(0, 8) }, req, ...args),
          );
        } catch (err) {
          return finish(
            NextResponse.json(
              fail(
                ErrCode.APIKEY_INVALID,
                err instanceof Error ? err.message : ErrMsg[ErrCode.APIKEY_INVALID]!,
              ),
              { status: 401 },
            ),
          );
        }
      }
      return finish(await handler({ userId: sessionUser, akPrefix: "session" }, req, ...args));
    });
  };
}

/** 数据范围：目标项目必须是本人可见项目（成员关系——与 web 面一致） */
export async function assertProjectVisible(
  userId: string,
  projectId: string,
): Promise<{ orgId: string }> {
  const member = await prisma.projectMember.findFirst({
    where: { projectId, userId },
    select: { id: true },
  });
  const project = member
    ? await prisma.project.findFirst({
        where: { id: projectId, deletedAt: null },
        select: { orgId: true },
      })
    : null;
  if (!project) {
    throw Object.assign(new Error("项目不存在或无权访问"), { code: ErrCode.PROJECT_NOT_FOUND });
  }
  return project;
}
