import { test, expect, navFromHome } from "./fixtures";

/**
 * API-001 + RPT-001 主链路（验收标准 4/5）。
 * 调试目标使用本地 mock 服务 /hello（稳定 JSON，避免外网抖动）；接口断言覆盖任务创建与报告详情。
 */
const MOCK_URL = process.env.E2E_MOCK_URL ?? "http://127.0.0.1:4000/hello";

test("API-001-01 调试执行成功 → 报告展示响应与断言通过（RPT-001）", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
  expectApi,
}) => {
  void authedPage;
  // 用户路径：首页 → 左侧菜单「接口调试」
  await navFromHome(page, "接口调试");
  await expect(page.getByTestId("debug-url")).toBeVisible();
  await page.getByRole("tab", { name: "断言" }).click();
  await expect(page.getByTestId("debug-asserts")).toBeVisible();

  await page.getByTestId("debug-url").fill(MOCK_URL);
  // 断言：状态码=200 + $.status contains UP
  await page.getByTestId("btn-add-assert").click();
  const assertRows = page.getByTestId("debug-asserts").locator("> div");
  await assertRows.nth(1).locator(".ant-select").first().click();
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText("响应体 JSONPath")
    .click();
  await assertRows.nth(1).locator('input[placeholder="$.url"]').fill("$.status");
  await assertRows.nth(1).locator('input[placeholder="期望值"]').fill("UP");

  const createTaskApi = expectApi("**/api/v1/projects/*/exec-tasks");
  // 报告详情监听与任务创建同时挂上（报告轮询在终态即停，挂晚会漏掉最后一次响应）
  const reportPromise = expectApi("**/api/v1/projects/*/reports/*");
  await page.getByTestId("btn-execute").click();
  const created = await createTaskApi;
  expect(created.status).toBe(201);
  expect(created.code).toBe(0);
  expect(created.data).toHaveProperty("taskId");

  // 报告页（RPT-001）：SSE/轮询收敛到 SUCCESS
  await expect(page).toHaveURL(/\/reports\//, { timeout: 15000 });
  await expect(page.getByTestId("report-status")).toHaveText("SUCCESS", { timeout: 30000 });
  const report = await reportPromise;
  expect(report.code).toBe(0);
  const detail = report.data as { response?: { status: number }; asserts: { passed: boolean }[] };
  expect(detail.response?.status).toBe(200);
  // UI 断言：响应体与断言通过行
  await expect(page.getByTestId("report-response-body")).toContainText("hello");
  await expect(page.getByTestId("assert-pass").first()).toBeVisible();
  // Console 断言：整条链路无错误（含 SSE）
  await expectNoConsoleErrors();
});

test("API-001-02 断言故意失败 → 报告 FAILED 且断言明细红行（验收标准 5）", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
}) => {
  void authedPage;
  await navFromHome(page, "接口调试");
  await page.getByRole("tab", { name: "断言" }).click();
  await page.getByTestId("debug-url").fill(MOCK_URL);
  // 断言期望 404（实际 200）→ 失败
  await page.getByTestId("debug-asserts").locator('input[placeholder="200"]').fill("404");
  await page.getByTestId("btn-execute").click();
  await expect(page).toHaveURL(/\/reports\//, { timeout: 15000 });
  await expect(page.getByTestId("report-status")).toHaveText("FAILED", { timeout: 30000 });
  // UI 断言：失败行红字「✗ 失败」+ 实际值 200
  await expect(page.getByTestId("assert-fail").first()).toBeVisible();
  await expect(page.getByText("200").first()).toBeVisible();
  await expectNoConsoleErrors();
});

test("API-001-03 URL 非法 → 提交被拒（422 就地提示）", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
}) => {
  void authedPage;
  await navFromHome(page, "接口调试");
  await page.getByTestId("debug-url").fill("not-a-url");
  await page.getByTestId("btn-execute").click();
  await expect(page.getByText("URL 必须以 http/https 开头")).toBeVisible();
  await expectNoConsoleErrors();
});

test("API-001-04 调试历史列表回看", async ({ authedPage, page, expectNoConsoleErrors }) => {
  void authedPage;
  await navFromHome(page, "接口调试");
  await page.getByTestId("debug-url").fill(MOCK_URL);
  await page.getByTestId("btn-execute").click();
  await expect(page).toHaveURL(/\/reports\//, { timeout: 15000 });
  await expect(page.getByTestId("report-status")).toHaveText("SUCCESS", { timeout: 30000 });
  // 用户路径：报告页「‹ 返回调试」
  await page.getByRole("link", { name: "‹ 返回调试" }).click();
  await expect(page.getByTestId("debug-url")).toBeVisible();
  // UI 断言：历史含刚才的请求（127.0.0.1:4000/hello）
  await expect(page.getByTestId("debug-history").getByText("4000/hello").first()).toBeVisible();
  await expectNoConsoleErrors();
});
