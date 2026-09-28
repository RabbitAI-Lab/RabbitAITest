import { test, expect } from "./fixtures";
import { bundle, createApiDef, createMockRule, getMockUrl, pollTask } from "./s2-helpers";
import {
  createScenario,
  customStep,
  executeScenario,
  loopForeachStep,
  saveSteps,
  scriptStep,
} from "./s3-helpers";

/**
 * RPT-003 场景报告与分享（规格：docs/sprint-3-scenario-automation/RPT-003-scenario-report-share.md）。
 * 三类断言：UI（五卡/步骤树/迭代分组/变量 Tab/误报徽标）+ Console + 接口（scenario-tree/分享 token/免登只读）。
 */

test("RPT-003-01 报告视图：五卡+步骤树节点状态+请求钻取+执行历史", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const pid = authedPage.projectId;
  const uniq = `R3${Date.now() % 1e7}`;
  const mockUrl = "http://127.0.0.1:4001/hello";

  const sc = await createScenario(request, pid, {
    name: `视图场景-${uniq}`,
    config: { params: { lists: [{ name: "rows", values: ["r1", "r2"] }] } },
  });
  await saveSteps(request, pid, sc.id, [
    loopForeachStep("遍历", "rows", customStep("迭代请求", mockUrl)),
    scriptStep("收尾脚本", 'setVar("done", "yes")'),
  ]);
  const taskId = await executeScenario(request, pid, sc.id);
  const final = await pollTask(request, pid, taskId);
  expect(final.status).toBe("SUCCESS");

  await page.goto(`/reports/${taskId}`);
  // 头部类型徽标 = 场景
  await expect(page.getByTestId("report-name")).toBeVisible();
  // 五卡 + 概览统计
  await expect(page.getByTestId("card-total")).toContainText("1");
  await expect(page.getByTestId("card-passed")).toContainText("1");
  await expect(page.getByTestId("card-fake")).toContainText("0");
  // 步骤树：loop 节点 + 2 迭代分组 + script 节点
  await expect(page.getByTestId("scenario-tree-card")).toBeVisible();
  const nodes = page.locator('[data-testid^="tree-node-"]');
  await expect(nodes.filter({ hasText: "迭代请求" }).first()).toBeVisible(); // loop 名为 fallback（帧不带控制器名，S4 优化项）
  await expect(nodes.filter({ hasText: "收尾脚本" })).toBeVisible();
  await expect(page.locator('[data-testid^="tree-iter-"]')).toHaveCount(2);
  // 迭代内叶子请求可钻取
  await nodes.filter({ hasText: "迭代请求" }).first().click();
  await expect(page.getByTestId("step-drill-panel")).toBeVisible();
  await expect(page.getByTestId("step-drill-body")).toBeVisible();
  // 变量 Tab：终值表
  await page.getByTestId("tree-tab-vars").click();
  await expect(page.getByTestId("scenario-vars-final").getByText("done")).toBeVisible();

  // 执行历史（场景列表 → 历史抽屉，接口断言记录）
  const hist = await request.get(`/api/v1/projects/${pid}/scenarios/${sc.id}/history`);
  const h = (await hist.json()) as { data: { taskId: string; status: string }[] };
  expect(h.data.some((x) => x.taskId === taskId)).toBe(true);

  await expectNoConsoleErrors();
});

test("RPT-003-02 分享链路复用：生成 token→免登页只读五卡（误报徽标同口径、无操作按钮）", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const pid = authedPage.projectId;
  const uniq = `R3${Date.now() % 1e7}`;
  const mockUrl = "http://127.0.0.1:4001/hello";

  const sc = await createScenario(request, pid, { name: `分享场景-${uniq}` });
  await saveSteps(request, pid, sc.id, [customStep("步骤", mockUrl)]);
  const taskId = await executeScenario(request, pid, sc.id);
  await pollTask(request, pid, taskId);

  // 生成分享链接（接口）
  const share = await request.post(`/api/v1/projects/${pid}/reports/${taskId}/shares`, {
    data: { expireHours: 1 },
  });
  expect(share.status()).toBe(201);
  const token = ((await share.json()) as { data: { token: string } }).data.token;

  // UI：详情页分享入口存在
  await page.goto(`/reports/${taskId}`);
  await expect(page.getByTestId("btn-share-report")).toBeVisible();

  // 免登只读：新上下文（无 cookie）打开分享页
  const ctx = await page.context().browser()!.newContext();
  const anon = await ctx.newPage();
  await anon.goto(`/share/report/${token}`);
  await expect(anon.getByTestId("share-report-view")).toBeVisible();
  await expect(anon.getByTestId("share-banner")).toContainText("只读分享");
  // 五卡同口径；无操作按钮（无重跑/分享/删除）
  await expect(anon.getByTestId("card-total")).toContainText("1");
  await expect(anon.getByTestId("card-fake")).toContainText("0");
  await expect(anon.getByTestId("btn-rerun-report")).toHaveCount(0);
  await expect(anon.getByTestId("btn-share-report")).toHaveCount(0);
  // 步骤树需登录口径提示
  await expect(anon.getByText("步骤树与变量视图需登录后在报告详情页查看")).toBeVisible();
  await ctx.close();

  await expectNoConsoleErrors();
});
