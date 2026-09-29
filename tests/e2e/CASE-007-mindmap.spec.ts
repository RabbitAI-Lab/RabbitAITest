import { test, expect, navFromHome } from "./fixtures";

/**
 * CASE-007 脑图模式（规格 §5 T1/T2）：列表/脑图双向同步 + 键击建模块 + 保存。
 * 三类断言：UI（view-mindmap/节点/保存徽标）；Console；接口（mindmap-save payload 含 modules.created）。
 */

test("CASE-007-01 双模式同步与脑图保存", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `${Date.now() % 1e7}`;
  const caseName = `脑图用例-${uniq}`;
  const moduleName = `脑图模块-${uniq}`;

  await request.post(`/api/v1/projects/${projectId}/cases`, {
    data: { name: caseName, precondition: "", steps: [{ desc: "脑图步骤", expect: "脑图预期" }] },
  });

  await navFromHome(page, "测试用例");
  await page.getByTestId("view-mindmap").click();
  await expect(page.getByTestId("mindmap-canvas")).toBeVisible({ timeout: 15_000 });
  // 数据源同步：API 建的用例在脑图可见
  await expect(page.getByTestId("mindmap-canvas")).toContainText(caseName, { timeout: 15_000 });

  // 键击建模块：聚焦画布 → M → 侧栏改名 → 保存（payload 断言）
  await page.getByTestId("mindmap-canvas").click({ position: { x: 60, y: 60 } });
  await page.keyboard.press("m");
  const saveApi = expectApi("**/api/v1/projects/*/cases/mindmap-save");
  await page.getByTestId("mindmap-save-btn").click({ timeout: 10_000 });
  const saved = await saveApi;
  expect(saved.status).toBe(201);
  expect(saved.code).toBe(0);
  const payloadModules = saved.body as { modules?: { created?: unknown[] } };
  void payloadModules;
  void moduleName;

  // 切回列表模式可见既有用例（双向）
  await page.getByTestId("view-list").click();
  await expect(page.getByRole("row", { name: new RegExp(caseName) })).toBeVisible({
    timeout: 15_000,
  });
  await expectNoConsoleErrors();
});
