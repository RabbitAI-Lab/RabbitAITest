/**
 * QA-002 登录暴力破解限流 e2e（rules/testing §1.2 三类断言）：
 * 三态：正常登录成功 → 同 IP（XFF 隔离）连续失败 5 次 → 第 6 次 429 10014（正确密码也拒）。
 * X-Forwarded-For 伪造隔离 IP：防污染 e2e 全局会话与后续用例（限流信任 XFF 首跳——部署须置于受信代理后，规格 §2 登记）。
 * 账号凭据经 authedPage fixture 注入（env 优先），本文件零凭据字面量。
 */
import { test, expect } from "./fixtures";
import { E2E_BASE } from "./env";

// 随机 IP（每轮唯一）：固定 XFF 会跨轮残留 Redis 失败计数（10 分钟窗口），首轮累计导致次轮首个请求即 429
const XFF = `10.88.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

test("QA-002-01 登录限流三态：成功 → 失败×5 锁定 → 429（正确密码也拒）", async ({
  authedPage,
  request,
  page,
  expectNoConsoleErrors,
}) => {
  const { email, password } = authedPage;

  // ── 态一：正常登录成功（无 XFF——独立 IP 口径 unknown，不受本用例锁定影响）──
  const okLogin = await request.post("/api/v1/auth/login", { data: { email, password } });
  expect(okLogin.status()).toBe(200);

  // ── 态二：XFF 隔离 IP 连续失败 5 次（HTTP 400 = 既有口径：BAD_CREDENTIALS 10102，SYS-001 T1-3 同）──
  for (let i = 0; i < 5; i++) {
    const fail = await request.post("/api/v1/auth/login", {
      data: { email, password: `${password}x` },
      headers: { "x-forwarded-for": XFF },
    });
    expect(fail.status()).toBe(400);
    const j = (await fail.json()) as { code: number };
    expect(j.code).toBe(10102);
  }

  // ── 态三：第 6 次（正确密码）→ 429 10014（锁定窗口内连正确密码也拒）──
  const locked = await request.post("/api/v1/auth/login", {
    data: { email, password },
    headers: { "x-forwarded-for": XFF },
  });
  expect(locked.status()).toBe(429);
  const lockedBody = (await locked.json()) as { code: number; message: string };
  expect(lockedBody.code).toBe(10014);
  expect(lockedBody.message).toContain("稍后再试");

  // ── UI 面：登录页输入被锁账号 → toast 错误呈现（UI 断言；清 cookie 防 /login 已登录重定向；
  //    route 注入同一 XFF——浏览器请求默认走 unknown IP，不注入则锁定态不生效且不互相污染）──
  await page.context().clearCookies();
  await page.route("**/api/v1/auth/login", (route) => {
    const headers = { ...route.request().headers(), "x-forwarded-for": XFF };
    return route.continue({ headers });
  });
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await expect(page.getByText(/稍后再试|请求过于频繁/)).toBeVisible({ timeout: 10_000 });
  // Console 断言：429 为本用例预期业务态（浏览器对 4xx 自动打 console.error）——白名单显式登记
  await expectNoConsoleErrors([
    {
      pageUrlPattern: "/login",
      textPattern: "429",
      reason: "QA-002 登录限流预期 429（业务态，非缺陷）",
    },
  ]);
});

test("QA-002-02 CSRF：跨源变更请求 403 10013（接口断言）+ 同源放行", async ({
  authedPage,
  request,
}) => {
  const { email, password } = authedPage;
  // 登录拿会话 cookie（request fixture 共享 cookie jar）
  const login = await request.post("/api/v1/auth/login", { data: { email, password } });
  expect(login.status()).toBe(200);

  // 恶意 Origin 的变更请求 → 403 10013
  const evil = await request.post("/api/v1/auth/logout", {
    data: {},
    headers: { origin: "http://evil.example" },
  });
  expect(evil.status()).toBe(403);
  const evilBody = (await evil.json()) as { code: number; message: string };
  expect(evilBody.code).toBe(10013);

  // 同源 Origin → 放行（logout 200）
  const same = await request.post("/api/v1/auth/logout", {
    data: {},
    headers: { origin: E2E_BASE },
  });
  expect(same.status()).toBe(200);
});
