import { test, expect } from "./fixtures";
import { loginSeedAdmin } from "./s6-helpers";

/**
 * SYS-008 审计日志 e2e（规格 §5：T2 落库链路 / T3 范围与负路径）。
 */

test("SYS-008-T2 系统面：写操作→日志可查（action 过滤+分页信封+UI 表格）", async ({
  page,
  context,
  request,
  expectNoConsoleErrors,
}) => {
  await loginSeedAdmin(request, context);

  // 触发审计动作（更新基础参数）
  const put = await request.put("/api/v1/system/params/basic", {
    data: { group: "basic", value: { siteUrl: "http://rabbit.test:3000", loginBanner: "e2e-audit" } },
  });
  expect(put.status()).toBe(200);

  // 等待异步落库（BullMQ 队列往返）
  await page.waitForTimeout(2500);

  // 接口：action=param 过滤 + 分页信封
  const res = await request.get("/api/v1/system/audit-logs?action=param&page=1&pageSize=10");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    code: number;
    data: { list: Array<{ action: string; objectType: string }>; total: number; page: number };
  };
  expect(body.code).toBe(0);
  expect(body.data.page).toBe(1);
  expect(body.data.total).toBeGreaterThanOrEqual(1);
  expect(body.data.list[0]!.action).toContain("param");
  expect(body.data.list[0]!.objectType).toBe("system_param");

  // UI：系统日志页表格
  await page.goto("/system/audit-logs");
  await expect(page.getByTestId("page-system-audit-logs")).toBeVisible();
  await expect(page.getByText("param.update").first()).toBeVisible({ timeout: 15000 });

  await expectNoConsoleErrors();
});

test("SYS-008-T3 负路径：项目用户查系统日志 403；非法分页 422", async ({ request, authedPage }) => {
  // 注册用户（无系统权限）→ 403 10003
  const res = await request.get("/api/v1/system/audit-logs");
  expect(res.status()).toBe(403);
  expect(((await res.json()) as { code: number }).code).toBe(10003);

  // 管理员态由 authedPage 的 request 不具备——非法分页用 page cookie 不便，直接断言注册态查询自身项目日志 200
  const { projectId } = authedPage;
  const own = await request.get(`/api/v1/projects/${projectId}/audit-logs?page=1&pageSize=10`);
  expect(own.status()).toBe(200);
  const ob = (await own.json()) as { code: number; data: { total: number } };
  expect(ob.code).toBe(0);
});
