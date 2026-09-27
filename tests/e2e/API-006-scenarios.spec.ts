import { test, expect, navFromHome } from "./fixtures";
import { bundle, createApiDef, createMockRule, getMockUrl, pickOption, pollTask } from "./s2-helpers";
import {
  clickRetry,
  createScenario,
  customStep,
  defaultScenarioModuleId,
  executeScenario,
  saveSteps,
  scriptStep,
  waitStep,
} from "./s3-helpers";

/**
 * API-006 场景编排（规格：docs/sprint-3-scenario-automation/API-006-scenario-orchestration.md）。
 * 三类断言：UI（列表/步骤树/编辑回读）+ Console（expectNoConsoleErrors）+ 接口（create/saveSteps/execute payload）。
 */

test("API-006-01 新建场景主链路：导航入口→弹窗→跳编辑页→列表呈现", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const uniq = `S6${Date.now() % 1e7}`;
  const name = `冒烟场景-${uniq}`;

  await navFromHome(page, "接口场景");
  // UI 断言：列表页骨架（模块树 scene=scenario + 场景页签 + 工具条入口）
  await expect(page.getByTestId("module-panel-scenario")).toBeVisible();
  await expect(page.getByTestId("scenarios-tab-list")).toBeVisible();
  await expect(page.getByTestId("btn-goto-false-alarm")).toBeVisible();
  await expect(page.getByTestId("btn-goto-schedules")).toBeVisible();

  // 弹窗新建（接口断言：POST payload 名称/模块合法）
  await page.getByTestId("btn-new-scenario").click();
  await page.getByTestId("input-new-scenario-name").fill(name);
  const created = expectApi("**/api/v1/projects/*/scenarios");
  await page.getByRole("button", { name: "创 建" }).click();
  const res = await created;
  expect(res.status).toBe(201);
  expect(res.code).toBe(0);
  const createdData = res.data as { num: number };
  expect(createdData.num).toBeGreaterThan(0);

  // 跳转编辑页（UI：名称回显 + 步骤树空态 + 五配置区 Tab）
  await expect(page.getByTestId("input-scenario-name")).toHaveValue(name);
  await expect(page.getByTestId("step-tree-panel")).toBeVisible();
  for (const tab of ["scenario-tab-step", "scenario-tab-params", "scenario-tab-prepost", "scenario-tab-asserts", "scenario-tab-settings"]) {
    await expect(page.getByTestId(tab)).toBeVisible();
  }

  // 返回列表：表格行呈现（名称 + 等级 P2 默认 + 步骤数 0）
  await navFromHome(page, "接口场景");
  await expect(page.getByTestId(`scenario-name-${createdData.num}`)).toHaveText(new RegExp(name));
  await expect(page.getByTestId(`scenario-row-${createdData.num}`).getByTestId("scenario-level")).toHaveText("P2");

  await expectNoConsoleErrors();
});

test("API-006-02 步骤树编排：三类步骤 UI 添加→保存→重载回读等价", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const pid = authedPage.projectId;
  const uniq = `S6${Date.now() % 1e7}`;
  const name = `编排场景-${uniq}`;
  const sc = await createScenario(request, pid, { name });
  const mockUrl = "http://127.0.0.1:4001/hello";

  await page.goto(`/scenarios/${sc.id}`);
  await expect(page.getByTestId("step-tree-panel")).toBeVisible();

  // 添加「自定义请求」根步骤（Dropdown 菜单）
  await page.getByTestId("btn-add-root-step").click();
  await clickRetry(page, page.locator(".ant-dropdown-menu-item").filter({ hasText: "自定义步骤" }).first());
  await expect(page.getByTestId("step-config-custom")).toBeVisible();
  // 请求编辑器（compact）填 mock URL
  await page.getByTestId("req-url").fill(mockUrl);

  // 添加「循环」根步骤
  await page.getByTestId("btn-add-root-step").click();
  await clickRetry(page, page.locator(".ant-dropdown-menu-item").filter({ hasText: "循环步骤" }).first());
  await expect(page.getByTestId("step-config-loop")).toBeVisible();
  await page.getByTestId("input-loop-count").fill("2");

  // 添加「脚本」根步骤
  await page.getByTestId("btn-add-root-step").click();
  await clickRetry(page, page.locator(".ant-dropdown-menu-item").filter({ hasText: "脚本步骤" }).first());
  await expect(page.getByTestId("step-config-script")).toBeVisible();
  await page.getByTestId("input-step-script").fill('setVar("trace", "s3")');

  // 保存（接口断言：PUT steps payload 含三类 stepType 与循环 count）
  const saved = page.waitForResponse(`**/api/v1/projects/${pid}/scenarios/${sc.id}/steps`);
  await page.getByTestId("btn-save-scenario").click();
  const res = await saved;
  expect(res.status()).toBe(200);
  const payload = res.request().postDataJSON() as { steps: { stepType: string; config: Record<string, unknown> }[] };
  const types = payload.steps.map((s) => s.stepType).sort();
  expect(types).toEqual(["custom", "loop", "script"]);
  expect((payload.steps.find((s) => s.stepType === "loop")!.config as { count?: number }).count).toBe(2);
  await expect(page.getByText(/已保存（v\d+）/)).toBeVisible();

  // 重载回读：树三行（UI）+ 详情步骤数（接口）
  await page.reload();
  await expect(page.getByTestId("step-tree-panel")).toBeVisible();
  const typesBadges = page.locator('[data-testid^="step-type-"]');
  await expect(typesBadges.filter({ hasText: "自定义" })).toBeVisible();
  await expect(typesBadges.filter({ hasText: "循环" })).toBeVisible();
  await expect(typesBadges.filter({ hasText: "脚本" })).toBeVisible();
  const detail = await request.get(`/api/v1/projects/${pid}/scenarios/${sc.id}`);
  const d = (await detail.json()) as { data: { stepCount: number } };
  expect(d.data.stepCount).toBe(3);

  // 变更历史（T5）：保存留痕（UI 抽屉 + 接口记录）
  await page.getByTestId("btn-scenario-changes").click();
  await expect(page.locator(".ant-drawer-title", { hasText: "变更历史" })).toBeVisible();
  const changes = await request.get(`/api/v1/projects/${pid}/scenarios/${sc.id}/changes`);
  const c = (await changes.json()) as { data: { items: { seq: number }[] } };
  expect(c.data.items.length).toBeGreaterThan(0);
  await page.keyboard.press("Escape");

  await expectNoConsoleErrors();
});

test("API-006-03 执行与场景报告：五卡+步骤树+步骤钻取", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const pid = authedPage.projectId;
  const uniq = `S6${Date.now() % 1e7}`;
  const mockUrl = "http://127.0.0.1:4001/hello";

  // API 造数：场景 = custom（成功）+ script + wait
  const sc = await createScenario(request, pid, { name: `报告场景-${uniq}` });
  await saveSteps(request, pid, sc.id, [customStep("打 mock", mockUrl), scriptStep("埋变量", 'setVar("t", "1")'), waitStep("歇一下", 5)]);
  const taskId = await executeScenario(request, pid, sc.id);
  await pollTask(request, pid, taskId); // 等终态（五卡数据回调后回填）

  // UI：列表行内「执行」入口存在 → 直接进报告页断言（行内执行在 API-008 覆盖弹窗）
  await navFromHome(page, "接口场景");
  await expect(page.getByTestId(`scenario-name-${sc.num}`)).toBeVisible();

  await page.goto(`/reports/${taskId}`);
  await expect(page.getByTestId("report-scenario-view")).toBeVisible();
  // 五卡（含误报单列）
  await expect(page.getByTestId("scenario-summary-cards")).toBeVisible();
  await expect(page.getByTestId("card-total")).toContainText("1");
  await expect(page.getByTestId("card-passed")).toContainText("1");
  await expect(page.getByTestId("card-fake")).toContainText("0");
  // 场景 item 表 + 步骤树卡
  await expect(page.getByTestId("scenario-items-table").getByText(`报告场景-${uniq}`)).toBeVisible();
  await expect(page.getByTestId("scenario-tree-card")).toBeVisible();
  const nodes = page.locator('[data-testid^="tree-node-"]');
  await expect(nodes.filter({ hasText: "打 mock" })).toBeVisible();
  await expect(nodes.filter({ hasText: "埋变量" })).toBeVisible();
  // 请求节点点击 → 步骤钻取（请求快照 = 渲染后值）
  await nodes.filter({ hasText: "打 mock" }).first().click();
  await expect(page.getByTestId("step-drill-panel")).toBeVisible();
  await expect(page.getByTestId("step-drill-panel")).toContainText("200");
  // 变量 Tab（varsFinal 含 script 写入的 t 与场景名注入）
  await page.getByTestId("tree-tab-vars").click();
  await expect(page.getByTestId("scenario-vars-final")).toBeVisible();

  await expectNoConsoleErrors();
});

test("API-006-04 回收站二态：软删→回收站页签→恢复重现", async ({ authedPage, page, request, expectNoConsoleErrors }) => {
  const pid = authedPage.projectId;
  const uniq = `S6${Date.now() % 1e7}`;
  const name = `回收场景-${uniq}`;
  const sc = await createScenario(request, pid, { name });

  await navFromHome(page, "接口场景");
  // 软删（Modal 确认）
  await page.getByTestId(`scenario-row-${sc.num}`).getByRole("button", { name: "删除" }).click();
  await page.getByRole("button", { name: "删 除", exact: true }).click();
  await expect(page.getByText("已移入回收站")).toBeVisible();

  // 回收站页签：行可见 + 恢复
  await page.getByTestId("scenarios-tab-recycle").click();
  await expect(page.getByTestId("recycle-table").getByText(name)).toBeVisible();
  await page.getByTestId(`btn-restore-${sc.num}`).click();
  await expect(page.getByText("已恢复")).toBeVisible();

  // 场景页签重现
  await page.getByTestId("scenarios-tab-list").click();
  await expect(page.getByTestId(`scenario-name-${sc.num}`)).toHaveText(new RegExp(name));

  await expectNoConsoleErrors();
});

test("API-006-05 受限成员（仅 PROJECT_SCENARIO:READ）：入口可见、新建/执行隐藏、直发 403", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const pid = authedPage.projectId;
  const meRes = await request.get("/api/v1/personal/me");
  const me = (await meRes.json()) as { data: { userId: string } };
  const groupsRes = await request.get(`/api/v1/projects/${pid}/groups`);
  const groups = (await groupsRes.json()) as { data: { id: string; name: string }[] };
  const adminGroup = groups.data.find((g) => g.name === "项目管理员");
  expect(adminGroup).toBeTruthy();

  // 自降权：移出「项目管理员」（剩组织管理员只读集，含 PROJECT_SCENARIO:READ 无 CREATE/UPDATE）
  const leave = await request.delete(`/api/v1/projects/${pid}/groups/${adminGroup!.id}/members/${me.data.userId}`);
  expect(leave.status()).toBe(200);

  await navFromHome(page, "接口场景");
  // UI 断言：列表可见（READ 保留），新建/批量执行/误报入口中写操作按钮隐藏
  await expect(page.getByTestId("module-panel-scenario")).toBeVisible();
  await expect(page.getByTestId("btn-new-scenario")).toHaveCount(0);
  await expect(page.getByTestId("btn-batch-exec")).toHaveCount(0);

  // 接口断言：受限会话直发创建 → 403 code 10003
  const post = await page.request.post(`/api/v1/projects/${pid}/scenarios`, {
    data: { name: "受限成员不应能创建", moduleId: await defaultScenarioModuleId(request, pid) },
  });
  expect(post.status()).toBe(403);
  expect(((await post.json()) as { code: number }).code).toBe(10003);

  // 二态回补：重新入组 → 新建按钮恢复
  const rejoin = await page.request.post(`/api/v1/projects/${pid}/groups/${adminGroup!.id}/members`, {
    data: { userIds: [me.data.userId] },
  });
  expect(rejoin.status()).toBe(200);
  await page.reload();
  await expect(page.getByTestId("btn-new-scenario")).toBeVisible();

  await expectNoConsoleErrors();
});
