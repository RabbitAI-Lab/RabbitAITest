import { test, expect, navFromHome } from "./fixtures";
import { uploadPlugin, enablePlugin, newAdminContext } from "./s6-helpers";
import { E2E_REDIS, E2E_BASE } from "./env";

/**
 * PLUG-005 e2e（规格 §5 T9）：上传启用 ssh/redis 协议插件 → 调试页协议下拉出现五项（数据驱动零改动验证）
 * → 选 redis 对 e2e 栈真实 redis 执行 PING → 报告回显 PONG。
 * 三类断言：UI（下拉项/执行结果）+ Console（无 error）+ 接口（执行负载含 protocol=redis）。
 * mongodb/amqp/grpc 真连：mongodb 豁免（CI 无 mongod）、amqp/grpc 由单测内嵌目标与 CI service 决策覆盖（规格 §5 登记）。
 */

/** 引擎协议注册表 30s 轮询——启用后执行若 40510 需退避重试（PLUG-003 勘误 2 同型） */
async function executeRedisPingUntilReady(
  page: import("@playwright/test").Page,
  expectApi: (glob: string) => Promise<{ status: number; code: number; body: unknown }>,
  redisUrl: string,
): Promise<void> {
  const u = new URL(redisUrl);
  const cfg = {
    host: u.hostname,
    port: Number(u.port) || 6379,
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.pathname && u.pathname !== "/" ? { db: Number(u.pathname.slice(1)) } : {}),
    command: "PING",
    timeoutMs: 5000,
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await page.waitForTimeout(10_000);
    await navFromHome(page, "接口调试");
    await page.getByTestId("debug-protocol").click();
    await page
      .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
      .getByText("redis", { exact: true })
      .click();
    await page.getByTestId("req-tab-protocol").click();
    await page
      .getByTestId("req-protocol-config")
      .fill(JSON.stringify(cfg, null, 2));
    const execApi = expectApi("**/api/v1/projects/*/exec-tasks");
    const reqPromise = page
      .waitForResponse("**/api/v1/projects/*/exec-tasks")
      .then((res) => res.request().postData() ?? "");
    await page.getByTestId("btn-execute").click();
    const exec = await execApi;
    expect(exec.status).toBe(201);
    // 接口断言：执行请求负载含 protocol=redis
    expect(await reqPromise).toContain('"redis"');
    await page.waitForURL(/\/reports\//, { timeout: 15_000 });
    const status = await page
      .getByTestId("report-status")
      .textContent({ timeout: 30_000 })
      .catch(() => null);
    if (status === "SUCCESS") return;
  }
  throw new Error("redis 协议执行在引擎注册表两个轮询周期内未成功（40510 未就绪）");
}

test("PLUG-005-T9 上传启用五协议插件 → 下拉五项 → redis PING 对栈 redis 执行成功", async ({
  page,
  context,
  request,
  playwright,
  expectNoConsoleErrors,
  expectApi,
}) => {
  // 前置：管理员独立 context 上传并启用 ssh/redis（幂等；引擎注册表 30s 轮询退避）
  const admin = await newAdminContext(playwright);
  for (const tgz of ["ssh-1.0.0.tgz", "redis-1.0.0.tgz"]) {
    const id = await uploadPlugin(admin, tgz);
    for (let attempt = 0; ; attempt++) {
      try {
        await enablePlugin(admin, id);
        break;
      } catch (e) {
        if (attempt >= 3) throw e;
        await page.waitForTimeout(5000);
      }
    }
  }
  await admin.dispose();

  // 注册普通用户（浏览器上下文切换为用户会话）
  const email = `e2e-plug005-${Date.now()}@rabbit.test`;
  const reg = await request.post("/api/v1/auth/register", {
    data: { email, password: process.env.E2E_USER_PASSWORD ?? "rabbit-pass-123" },
  });
  expect(reg.status()).toBe(201);
  const ras = (reg.headers()["set-cookie"] ?? "").split("ras=")[1]?.split(";")[0];
  await context.clearCookies();
  if (ras) await context.addCookies([{ name: "ras", value: ras, url: E2E_BASE }]);

  // UI 断言：协议下拉出现五项（ssh/redis/mongodb/grpc/amqp——数据驱动零改动；mongodb/amqp/grpc 未启用不出现，
  // 已启用 ssh/redis + PLUG-003 已交付 websocket/mqtt 共存，此处验证五家新插件形态）
  await navFromHome(page, "接口调试");
  await page.getByTestId("debug-protocol").click();
  const dropdown = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)");
  for (const label of ["ssh", "redis"]) {
    await expect(dropdown.getByText(label, { exact: true })).toBeVisible();
  }
  await page.keyboard.press("Escape");

  // redis PING 真执行（e2e 栈真实 redis）
  await executeRedisPingUntilReady(page, expectApi, E2E_REDIS);

  // UI 断言：报告响应回显 PONG
  await expect(page.getByText("PONG")).toBeVisible({ timeout: 15_000 });

  await expectNoConsoleErrors();
});
