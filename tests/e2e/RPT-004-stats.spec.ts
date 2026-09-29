import { test, expect, navFromHome } from "./fixtures";
import { MOCK_BASE } from "./s2-helpers";

/**
 * S-future RPT-004 e2e（规格 §5 T6）：执行一轮调试后统计页可见当日增量；窗口切换；空态。
 * 三类断言：UI（趋势/分布/TOP 三块渲染）+ Console（无错误）+ 接口（stats 负载 days）。
 */

test("RPT-004-T6 调试执行一轮 → 统计页趋势增量 + 窗口切换 + 分布卡", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
  expectApi,
}) => {
  void authedPage;
  // 前置：执行一次调试（mock hello）产生当日报告
  await navFromHome(page, "接口调试");
  await page.getByTestId("debug-url").fill(`${MOCK_BASE}/hello`);
  await page.getByTestId("btn-execute").click();
  await page.waitForURL(/\/reports\//, { timeout: 15_000 });
  await expect(page.getByTestId("report-status")).toHaveText("SUCCESS", { timeout: 30_000 });

  // 统计页（报告页签导航进入）
  await page.goto("/reports");
  await page.getByTestId("report-tab").getByText("统计").click();
  await page.waitForURL(/\/reports\/stats/);
  await expect(page.getByTestId("stats-trend")).toBeVisible({ timeout: 15000 });
  // UI 断言：当日增量（Σtotal ≥ 1，passRate 呈百分比）
  await expect(page.getByTestId("stats-trend-summary")).toContainText("Σtotal", { timeout: 15000 });
  const summaryText = await page.getByTestId("stats-trend-summary").textContent();
  expect(summaryText).toMatch(/Σtotal [1-9]/);
  await expect(page.getByTestId("stats-bytype")).toBeVisible();
  await expect(page.getByTestId("stats-topfailed")).toBeVisible();

  // 窗口切换 7 天：接口断言 days=7 且刷新
  const stats7 = expectApi("**/api/v1/projects/*/reports/stats*");
  await page.getByTestId("stats-range").getByText("7 天").click();
  const resp7 = await stats7;
  expect(resp7.status).toBe(200);
  expect(resp7.code).toBe(0);
  expect(JSON.stringify(resp7.body)).toContain('"days":7');
  await expect(page.getByTestId("stats-trend")).toBeVisible();

  await expectNoConsoleErrors();
});

test("RPT-004-T6b 空窗口态：新项目无报告 → 空态引导（非错误）", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
  expectApi,
}) => {
  void authedPage;
  const stats = expectApi("**/api/v1/projects/*/reports/stats*");
  await page.goto("/reports/stats");
  const resp = await stats;
  expect(resp.status).toBe(200);
  expect(resp.code).toBe(0);
  await expect(page.getByTestId("stats-empty")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("窗口内暂无报告")).toBeVisible();
  await expectNoConsoleErrors();
});
