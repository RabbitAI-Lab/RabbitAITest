import { NextResponse } from "next/server";
import { z } from "zod";
import { DomainError, ErrCode, ErrMsg, fail, ok, ldapLoginSchema } from "@rabbit/shared";
import { toResponse } from "@/server/guard";
import { loginUser, audit } from "@/server/domains/system/auth.service";
import { getSession } from "@/lib/session";
import { rateCount, rateLimit, rateReset } from "@/server/rate-limit";
import { entpFeatureActive } from "@/server/domains/entp/license.service";
import { loadSource } from "@/server/domains/entp/sso.service";
import { ldapAuthenticate } from "@/server/domains/entp/ldap-client";
import { findOrCreateSsoUser } from "@/server/domains/entp/sso-flow.service";

export const runtime = "nodejs";

/** 本地口令（默认，SYS-001 兼容）∪ LDAP 目录登录（ENTP-002，mode=ldap）。 */
const localSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

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
    const rawBody = (await req.json()) as Record<string, unknown>;
    const isLdap = rawBody.mode === "ldap";
    const parsed = isLdap ? ldapLoginSchema.safeParse(rawBody) : localSchema.safeParse(rawBody);
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
    // ENTP-002：LDAP 目录登录（mode=ldap → bind+search+二次 bind → find-or-create）
    if (isLdap) {
      const ldapInput = parsed.data as z.infer<typeof ldapLoginSchema>;
      if (!(await entpFeatureActive("SSO"))) {
        return NextResponse.json(
          fail(ErrCode.LICENSE_REQUIRED, ErrMsg[ErrCode.LICENSE_REQUIRED]!),
          { status: 403 },
        );
      }
      const src = await loadSource(ldapInput.authId);
      if (src.type !== "LDAP" || !src.enabled) {
        return NextResponse.json(fail(ErrCode.SSO_SOURCE_DISABLED, "LDAP 认证源不存在或已停用"), {
          status: 422,
        });
      }
      const identity = await ldapAuthenticate(src.config, ldapInput.username, ldapInput.password);
      if (!identity) {
        await rateLimit("login-fail", ip, LOGIN_FAIL_LIMIT, LOGIN_FAIL_WINDOW);
        // 与本地口令同码同文案（防枚举）
        return NextResponse.json(fail(ErrCode.BAD_CREDENTIALS, ErrMsg[ErrCode.BAD_CREDENTIALS]!), {
          status: 401,
        });
      }
      const user = await findOrCreateSsoUser(
        { providerUserId: identity.username, name: identity.name, email: identity.email },
        "LDAP",
      );
      await rateReset("login-fail", ip, LOGIN_FAIL_WINDOW);
      const session = await getSession();
      session.userId = user.userId;
      session.email = user.email;
      await session.save();
      await audit(user.userId, "login", "user", user.userId);
      return NextResponse.json(ok({ userId: user.userId, email: user.email }));
    }
    const localInput = parsed.data as z.infer<typeof localSchema>;
    const { userId, email } = await loginUser(localInput.email, localInput.password);
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
