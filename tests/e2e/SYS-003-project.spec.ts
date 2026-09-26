import { test, expect } from "./fixtures";

/** SYS-003 默认组织/项目 + 项目切换器（T2）。 */
test("SYS-003-01 注册即见「演示项目」，切换器含项目与 OWNER 角色", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const projectsApi = expectApi("**/api/v1/personal/projects");
  await page.goto("/");
  const res = await projectsApi;
  expect(res.code).toBe(0);
  // UI 断言
  await expect(page.getByTestId("project-switcher")).toBeVisible();
  const text = await page.getByTestId("project-switcher").innerText();
  expect(text).toContain("演示项目");
  expect(text).toContain("OWNER");
  void authedPage;
  await expectNoConsoleErrors();
});
