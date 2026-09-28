import { test, expect } from "./fixtures";
import { loginSeedAdmin } from "./s6-helpers";

/**
 * S-future LOAD-001 e2e（规格 §5 T4）：模块开关 → 导航显隐 → 占位页三态。
 * 三类断言：UI（开关/导航组/占位页）+ Console（无错误）+ 接口（PUT modules 负载与回显）。
 */

test("LOAD-001-T4 开关开启→导航出现占位入口→占位页呈现→关闭即隐", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  // 前置：导航默认无「性能测试」组（占位默认关）
  await page.goto("/");
  await expect(page.getByTestId("nav-load")).toHaveCount(0);

  // 设置页开启开关（企业版方向行存在且默认关）
  await page.goto("/settings/info");
  const loadSwitch = page.getByTestId("module-switch-load");
  await expect(loadSwitch).toBeVisible();
  await expect(loadSwitch).not.toHaveClass(/ant-switch-checked/);
  await expect(page.getByText("性能测试", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("企业版方向").first()).toBeVisible();

  const putApi = expectApi(`**/api/v1/projects/${projectId}`);
  await loadSwitch.click();
  await page.getByTestId("btn-save-info").click();
  const put = await putApi;
  expect(put.status).toBe(200);
  expect(put.code).toBe(0);
  await expect(page.getByText("基本信息已保存")).toBeVisible({ timeout: 8000 });

  // 导航组出现（模块开关 ∧ PROJECT_LOAD:READ 双门控——注册用户=本项目管理员）
  await page.goto("/");
  await expect(page.getByTestId("nav-load")).toBeVisible();

  // 占位页：标题+空态卡+置灰能力清单（零数据面）
  await page.getByTestId("nav-load").click();
  await expect(page).toHaveURL(/\/load$/);
  await expect(page.getByText("性能测试 · 企业版方向规划中")).toBeVisible();
  await expect(page.getByTestId("load-placeholder")).toBeVisible();
  await expect(page.getByText("分布式压力节点")).toBeVisible();

  // 关闭 → 导航隐藏（数据零迁移语义）
  await page.goto("/settings/info");
  const offApi = expectApi(`**/api/v1/projects/${projectId}`);
  await page.getByTestId("module-switch-load").click();
  await page.getByTestId("btn-save-info").click();
  expect((await offApi).status).toBe(200);
  await expect(page.getByText("基本信息已保存")).toBeVisible({ timeout: 8000 });
  await page.goto("/");
  await expect(page.getByTestId("nav-load")).toHaveCount(0);

  await expectNoConsoleErrors();
});

test("LOAD-001-T4b 资源池 DTO 占位字段（loadTest/uiTest=false 联动 §4）", async ({
  page,
  request,
  context,
  expectNoConsoleErrors,
}) => {
  await loginSeedAdmin(request, context);
  await page.goto("/system/pools");
  await expect(page.getByText("默认资源池").first()).toBeVisible({ timeout: 15000 });
  const res = await request.get("/api/v1/system/pools");
  const body = (await res.json()) as {
    code: number;
    data: { items: Array<{ loadTest: boolean; uiTest: boolean }> };
  };
  expect(body.code).toBe(0);
  expect(body.data.items[0]?.loadTest).toBe(false);
  expect(body.data.items[0]?.uiTest).toBe(false);
  await expectNoConsoleErrors();
});
