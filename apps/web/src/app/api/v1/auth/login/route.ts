import { NextResponse } from "next/server";
import { z } from "zod";
import { DomainError, ErrCode, ErrMsg, fail, ok } from "@rabbit/shared";
import { toResponse } from "@/server/guard";
import { loginUser, audit } from "@/server/domains/system/auth.service";
import { getSession } from "@/lib/session";
import { rateCount, rateLimit, rateReset } from "@/server/rate-limit";

export const runtime = "nodejs";

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

/** QA-002 登录暴力破解限流：同 IP 连续失败 ≥5 次锁 10 分钟（成功清零；审计留痕）。 */
const LOGIN_FAIL_LIMIT = 5;
const LOGIN_FAIL_WINDOW = 600;

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { code: 20422, message: "参数校验失败", data: null },
        { status: 422 },
      );
    }
    if ((await rateCount("login-fail", ip, LOGIN_FAIL_WINDOW)) >= LOGIN_FAIL_LIMIT) {
      void audit(null, "login.rate_limited", "user").catch(() => {});
      return NextResponse.json(
        fail(ErrCode.LOGIN_RATE_LIMITED, ErrMsg[ErrCode.LOGIN_RATE_LIMITED]!),
        {
          status: 429,
        },
      );
    }
    const { userId, email } = await loginUser(parsed.data.email, parsed.data.password);
    await rateReset("login-fail", ip, LOGIN_FAIL_WINDOW);
    const session = await getSession();
    session.userId = userId;
    session.email = email;
    await session.save();
    await audit(userId, "login", "user", userId);
    return NextResponse.json(ok({ userId, email }));
  } catch (err) {
    if (err instanceof DomainError && err.code === ErrCode.BAD_CREDENTIALS) {
      await rateLimit("login-fail", ip, LOGIN_FAIL_LIMIT, LOGIN_FAIL_WINDOW); // 失败计数（incr 副作用）
    }
    return toResponse(err);
  }
}
