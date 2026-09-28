import { test, expect } from "./fixtures";

/**
 * S-future UIT-001 e2e（规格 §5 T3，与 LOAD-001 同构）：uit 开关 → 导航 → 占位页。
 * 三类断言：UI + Console + 接口（PUT modules.uit 负载与回显）。
 */

test("UIT-001-T3 开启 uit 开关→导航/占位页→能力清单口径", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  await page.goto("/");
  await expect(page.getByTestId("nav-uit")).toHaveCount(0);

  await page.goto("/settings/info");
  const uitSwitch = page.getByTestId("module-switch-uit");
  await expect(uitSwitch).toBeVisible();
  await expect(uitSwitch).not.toHaveClass(/ant-switch-checked/);

  const putApi = expectApi(`**/api/v1/projects/${projectId}`);
  await uitSwitch.click();
  await page.getByTestId("btn-save-info").click();
  const put = await putApi;
  expect(put.status).toBe(200);
  expect(put.code).toBe(0);
  await expect(page.getByText("基本信息已保存")).toBeVisible({ timeout: 8000 });

  await page.goto("/");
  await expect(page.getByTestId("nav-uit")).toBeVisible();
  await page.getByTestId("nav-uit").click();
  await expect(page).toHaveURL(/\/ui-test$/);
  await expect(page.getByText("UI 测试 · 企业版方向规划中")).toBeVisible();
  await expect(page.getByTestId("uit-placeholder")).toBeVisible();
  // 能力清单口径（UIT-001 §1.2）：四项置灰能力
  await expect(page.getByText("UI 自动化用例编排")).toBeVisible();
  await expect(page.getByText("视觉快照对比")).toBeVisible();
  await expectNoConsoleErrors();
});
