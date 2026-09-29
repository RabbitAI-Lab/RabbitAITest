import { test, expect, navFromHome } from "./fixtures";
import { createApiDef, bundle, createMockRule, getMockUrl, pollTask } from "./s2-helpers";
import {
  clickRetry,
  conditionStep,
  createScenario,
  customStep,
  loopForeachStep,
  saveSteps,
  scriptStep,
  waitStep,
} from "./s3-helpers";

/**
 * MAINFLOW-s3 场景自动化主链路（需求文档 §五 端到端可演示路径）：
 * 建场景 → 编排（自定义请求/循环 foreach/条件/仅一次/脚本/等待 + 引用接口定义）→ CSV 参数化
 * → 执行 → 报告步骤树（迭代分组+变量终值）→ 误报规则命中 → 导出。
 */
test("MAINFLOW-s3 建场景→编排→CSV→执行→报告树→误报→导出 全链路", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const pid = authedPage.projectId;
  const uniq = `MF${Date.now() % 1e7}`;

  // ── 准备：mock 定义（被引用步骤执行定义的 url——引用语义，用可达的 mock 内置端点） ──
  const mockUrl = "http://127.0.0.1:4001/hello";
  const def = await createApiDef(request, pid, {
    name: `主链路定义-${uniq}`,
    path: "/hello",
    request: bundle("GET", mockUrl),
  });

  // ── 1. 建场景（UI 弹窗） ──
  await navFromHome(page, "接口场景");
  await page.getByTestId("btn-new-scenario").click();
  await page.getByTestId("input-new-scenario-name").fill(`主链路场景-${uniq}`);
  await page.getByRole("button", { name: "创 建" }).click();
  await expect(page.getByTestId("input-scenario-name")).toHaveValue(`主链路场景-${uniq}`);

  // ── 2. 参数区：CSV inline 两行（UI 编辑） ──
  await page.getByTestId("scenario-tab-params").click();
  await page.getByTestId("input-csv-inline").fill("user,city\nalice,北京\nbob,上海");
  await expect(page.getByTestId("csv-preview")).toBeVisible();

  // ── 3. 编排：引用接口 + 自定义 + 循环(foreach 列表) + 条件 + 仅一次 + 脚本 + 等待 ──
  // 常量列表（foreach 源）经 UI 添加一组列表
  await page.getByTestId("params-lists").getByText("＋ 添加列表").click();
  await page.getByTestId("params-lists").getByPlaceholder("列表名").fill("cities");
  await page.getByTestId("params-lists").locator(".ant-select").first().click();
  await page.keyboard.type("北京");
  await page.keyboard.press("Enter");

  await page.getByTestId("scenario-tab-step").click();
  const addStep = async (menu: string) => {
    await page.getByTestId("btn-add-root-step").click();
    await clickRetry(
      page,
      page.locator(".ant-dropdown-menu-item").filter({ hasText: menu }).first(),
    );
  };
  // 3.1 引用接口（目标选择器选 mock 定义）
  await addStep("接口步骤");
  await expect(page.getByTestId("step-config-ref")).toBeVisible();
  await page.getByTestId("ref-picker-api").click();
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText(`主链路定义-${uniq}`)
    .first()
    .click();
  // 3.2 自定义请求（mock URL）
  await addStep("自定义步骤");
  await page.getByTestId("req-url").fill(mockUrl);
  // 3.3 循环 foreach 绑定列表 cities
  await addStep("循环步骤");
  await page.getByTestId("radio-loop-mode").getByText("ForEach").click();
  await page.getByTestId("input-loop-foreach-source").locator("input").fill("cities");
  await page.getByTestId("input-loop-foreach-var").fill("city");
  // 3.4 脚本 + 3.5 等待 + 3.6 条件（子步骤经 API 补齐，UI 主链路已覆盖交互面）
  await addStep("脚本步骤");
  await page.getByTestId("input-step-script").fill('setVar("trace", "mfs3")');
  await addStep("等待步骤");

  // ── 4. 保存（配置 + 步骤树） ──
  await page.getByTestId("btn-save-scenario").click();
  await expect(page.getByText(/已保存（v\d+）/)).toBeVisible();

  // 重载后 API 补条件/仅一次子树与断言（覆盖 7 类编排，UI 交互已验证代表性类型）
  const detail = await request.get(
    `/api/v1/projects/${pid}/scenarios?keyword=${encodeURIComponent(`主链路场景-${uniq}`)}`,
  );
  const list = (await detail.json()) as { data: { items: { id: string; num: number }[] } };
  const sc = list.data.items[0]!;
  await saveSteps(request, pid, sc.id, [
    {
      uid: "mf-ref",
      stepType: "ref_api",
      name: "引用接口",
      enabled: true,
      config: { refId: def.id },
      children: [],
    },
    customStep("自定义请求", mockUrl),
    loopForeachStep("遍历城市", "cities", customStep("城市请求", mockUrl)),
    conditionStep("条件分支", 'getVar("trace") === "mfs3"', [customStep("分支内请求", mockUrl)]),
    {
      uid: "mf-once",
      stepType: "once",
      name: "仅一次",
      enabled: true,
      config: {},
      children: [customStep("一次性请求", mockUrl)],
    },
    scriptStep("埋变量", 'setVar("trace", "mfs3")'),
    waitStep("歇一下", 5),
  ]);

  // ── 5. 执行（UI 头部执行按钮）→ 报告 ──
  const fired = page.waitForResponse(`**/api/v1/projects/${pid}/scenarios/${sc.id}/execute`);
  await page.getByTestId("btn-exec-scenario").click();
  const exec = await fired;
  expect(exec.status()).toBe(201);
  const task = (await exec.json()) as { data: { taskId: string } };
  await page.waitForURL(/\/reports\//);
  // 报告收敛（SSE + 轮询兜底）后断言
  const final = await pollTask(request, pid, task.data.taskId);
  expect(final.status).toBe("SUCCESS");
  await page.reload();
  await expect(page.getByTestId("report-scenario-view")).toBeVisible();
  await expect(page.getByTestId("card-passed")).toContainText("1");
  // 步骤树：引用/循环迭代分组/条件分支
  const nodes = page.locator('[data-testid^="tree-node-"]');
  await expect(nodes.filter({ hasText: "引用接口" })).toBeVisible();
  await expect(nodes.filter({ hasText: "城市请求" }).first()).toBeVisible(); // loop 名 fallback（S4 优化）
  await expect(page.locator('[data-testid^="tree-iter-"]')).toHaveCount(1);
  await expect(nodes.filter({ hasText: "条件分支" })).toBeVisible();
  // 变量终值 Tab
  await page.getByTestId("tree-tab-vars").click();
  await expect(page.getByTestId("scenario-vars-final").getByText("trace")).toBeVisible();

  // ── 6. 误报规则（API 建 + 再造一次失败执行验证 FAKE_ERROR） ──
  await request.post(`/api/v1/projects/${pid}/false-alarm-rules`, {
    data: {
      name: `主链路误报-${uniq}`,
      matcher: { bodyContains: "hello" },
      enabled: true,
      description: "",
    },
  });
  const failSc = await createScenario(request, pid, { name: `主链路失败件-${uniq}` });
  await saveSteps(request, pid, failSc.id, [
    customStep("必败", mockUrl, [{ kind: "status_code", path: "", op: "eq", expected: "500" }]),
  ]);
  const failTask = await (async () => {
    const r = await request.post(`/api/v1/projects/${pid}/scenarios/${failSc.id}/execute`, {
      data: {},
    });
    return ((await r.json()) as { data: { taskId: string } }).data.taskId;
  })();
  await pollTask(request, pid, failTask);
  await page.goto(`/reports/${failTask}`);
  await expect(page.locator('[data-testid^="fake-badge-"]').first()).toBeVisible();
  await expect(page.getByTestId("card-fake")).toContainText("1");

  // ── 7. 导出（API attachment 断言，UI 入口在列表页） ──
  await navFromHome(page, "接口场景");
  await page.getByTestId(`scenario-row-${sc.num}`).locator('input[type="checkbox"]').check();
  await expect(page.getByTestId("btn-export-ref")).toBeEnabled();
  const exp = await request.post(`/api/v1/projects/${pid}/scenarios/export`, {
    data: { ids: [sc.id], mode: "ref" },
  });
  expect(exp.status()).toBe(200);
  const expBody = (await exp.json()) as { scenarios: { steps: unknown[] }[] };
  expect(expBody.scenarios[0]!.steps).toHaveLength(7);

  await expectNoConsoleErrors();
});
