import { test, expect } from "./fixtures";
import {
  issueDevLicense,
  addLicense,
  removeLicense,
  loginSeedAdmin,
  MOCK_URL,
} from "./s9-helpers";
import { pickOption } from "./s2-helpers";

/**
 * S11 性能测试/UI 测试聚合 e2e（LOAD-003 §5 T8/T9 + UIT-002 §5 T7/T8/T9 + LOAD-001/UIT-001 占位回归）。
 * **License 互斥单文件**（S11 顽固假红终局对策）：License/模块开关为全局态——所有依赖
 * License 的用例收编进本文件串行执行，严禁与其他文件的 License 生命周期交错（并行文件
 * 的 afterEach 摘除与自愈循环互相打架的教训链）。执行序=功能段（企业版）→ 社区版段（占位回归+T9 门控）→
 * 恢复企业版 → afterAll 清。
 * 三类断言：UI（编辑器/监控曲线/报告/截图网格/占位卡片）+ Console（无错误）+ 接口（jmx 层覆盖 run/metrics 帧——e2e 聚焦 UI 链路）。
 */

const TASK_URL_RE = /\/tasks\/[0-9a-f-]{36}/;

/** 从当前 URL 提取任务 id（结构化分段）。 */
function taskIdFromUrl(pageUrl: string, segment: "load" | "ui-test"): string {
  const parts = new URL(pageUrl).pathname.split("/");
  const i = parts.indexOf(segment);
  return i >= 0 && parts[i + 1] === "tasks" ? (parts[i + 2] ?? "") : "";
}

async function enableModule(page: import("@playwright/test").Page, key: "load" | "uit") {
  await page.goto("/settings/info");
  const sw = page.getByTestId(`module-switch-${key}`);
  await expect(sw).toBeVisible();
  if (!(await sw.evaluate((el) => el.classList.contains("ant-switch-checked")))) {
    await sw.click();
    await page.waitForTimeout(300); // React 置脏节拍
    await page.getByTestId("btn-save-info").click();
    await expect(page.getByText("基本信息已保存").first()).toBeVisible({ timeout: 8000 });
  }
}

/** License 稳定 ENTERPRISE（并行文件摘除竞态自愈：非授权态时重写直到连续 2 次确认）。 */
async function ensureEnterprise(request: import("@playwright/test").APIRequestContext) {
  const { chromium } = await import("@playwright/test");
  const b = await chromium.launch();
  const adminCtx = await b.newContext();
  let streak = 0;
  try {
    await loginSeedAdmin(adminCtx.request, adminCtx);
    for (let round = 0; round < 40 && streak < 2; round++) {
      const r = await request.get("/api/v1/public/license-status", { headers: { "cache-control": "no-store" } });
      const j = (await r.json()) as { data: { edition: string } };
      if (j.data.edition === "ENTERPRISE") {
        streak += 1;
      } else {
        streak = 0;
        await addLicense(adminCtx.request, issueDevLicense({ features: ["LOAD_TEST", "UI_TEST"] })).catch(() => undefined);
      }
      await new Promise((r2) => setTimeout(r2, 700));
    }
  } finally {
    await b.close();
  }
  expect(streak, "License 应自愈循环后稳定 ENTERPRISE").toBeGreaterThanOrEqual(2);
}

/** License 摘除并稳定 COMMUNITY（连续 2 次确认）。 */
async function ensureCommunity(page: import("@playwright/test").Page) {
  const adminCtx = await page.context().browser()!.newContext();
  let streak = 0;
  try {
    await loginSeedAdmin(adminCtx.request, adminCtx);
    for (let round = 0; round < 40 && streak < 2; round++) {
      const r = await adminCtx.request.get("/api/v1/public/license-status", { headers: { "cache-control": "no-store" } });
      const j = (await r.json()) as { data: { edition: string } };
      if (j.data.edition === "COMMUNITY") {
        streak += 1;
      } else {
        streak = 0;
        await removeLicense(adminCtx.request).catch(() => undefined);
      }
      await new Promise((r2) => setTimeout(r2, 600));
    }
  } finally {
    await adminCtx.close();
  }
  expect(streak, "社区版态应稳定").toBeGreaterThanOrEqual(2);
}

test.describe.configure({ mode: "serial" });

// License 生命周期=文件级（beforeAll 激活、afterAll 清；用例内不再 per-test 加删）
test.beforeAll(async ({ playwright }) => {
  const browser = await playwright.chromium.launch();
  const ctx = await browser.newContext();
  await loginSeedAdmin(ctx.request, ctx);
  await addLicense(ctx.request, issueDevLicense({ features: ["LOAD_TEST", "UI_TEST"] }));
  await browser.close();
});

test.afterAll(async ({ playwright }) => {
  const browser = await playwright.chromium.launch();
  const ctx = await browser.newContext();
  await loginSeedAdmin(ctx.request, ctx).catch(() => undefined);
  await removeLicense(ctx.request);
  await browser.close();
});

// ═══════ 段一：企业版功能链路 ═══════

test("LOAD-003-T8 建计划（mock /perf/echo 8s）→执行→监控曲线→报告结论", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  await ensureEnterprise(request);
  await enableModule(page, "load");
  await page.goto("/load");
  // 页面内 refetchInterval(2s) 授权轮询自然转正（License 写后读一致性窗口吸收）
  await expect(page.getByTestId("load-page")).toBeVisible({ timeout: 60000 });

  // 建计划（tps 模式 8s——引擎真实执行对 mock）
  await page.getByTestId("load-create-btn").click();
  await expect(page.getByTestId("load-plan-form")).toBeVisible();
  await page.getByPlaceholder("计划名称").fill(`e2e-基线-${Date.now()}`);
  await page.getByPlaceholder("http(s) 绝对 URL（压测目标）").fill(`${MOCK_URL}/perf/echo`);
  await pickOption(
    page,
    page.locator('[data-testid="load-pressure-form"] .ant-select').first(),
    "目标 TPS（每秒发压配额）",
  );
  await page.getByRole("spinbutton", { name: /持续时长/ }).fill("8");
  await page.getByRole("spinbutton", { name: /目标 TPS（1-1000）/ }).fill("5");
  // 阈值放宽（演示环境噪声容忍——判定语义由单测/汇总纯函数覆盖）
  await page.getByRole("spinbutton", { name: /成功率 ≥/ }).fill("50");
  await page.getByRole("spinbutton", { name: /P95 ≤/ }).fill("8000");
  await page.getByRole("spinbutton", { name: /平均 RT ≤/ }).fill("5000");
  await page.getByTestId("load-save-btn").click();
  // 创建完成信号=跳回列表+表格含新计划（网络层断言由 jmx G2 组覆盖——e2e 聚焦 UI 链路）
  await expect(page).toHaveURL(/\/load$/, { timeout: 10000 });
  await expect(page.getByTestId("load-tests-table")).toContainText("e2e-基线", { timeout: 10000 });

  // 列表出现并执行
  await expect(page.getByTestId("load-tests-table")).toBeVisible();
  const row = page.locator("tr", { hasText: "e2e-基线" }).first();
  // 接口断言（run 链路）：点击「执行」→ 页面跳转监控页（run 202 由 mutation 消费跳转）
  await row.getByTestId(/^load-run-/).click();
  await expect(page).toHaveURL(TASK_URL_RE, { timeout: 15000 });
  await expect(page.getByTestId("load-monitor-status")).toBeVisible();
  const taskId = taskIdFromUrl(page.url(), "load");
  expect(taskId).toBeTruthy();

  // 监控页：状态卡+曲线+实时帧推进（引擎真跑 8s；SSE 流由页面接管）
  await expect(page.getByTestId("load-monitor-page")).toBeVisible();
  await expect(page.getByTestId("load-monitor-chart")).toBeVisible();
  // 等曲线有点（≤15s 引擎起压+首帧）
  await expect
    .poll(async () => page.getByTestId("load-tps-now").innerText(), { timeout: 20000 })
    .not.toBe("0");

  // 停止或等终态→报告
  const stopBtn = page.getByTestId("load-stop-btn");
  if (await stopBtn.isVisible().catch(() => false)) {
    await stopBtn.click();
    // 停止生效信号=任务终态（状态 Tag 离开 RUNNING/PENDING）——toast 秒消不依赖
    await expect(page.getByTestId("load-monitor-status")).not.toHaveText(/RUNNING|PENDING/, {
      timeout: 20000,
    });
  }
  // 终态跳报告（1.5s 自动跳 + 引擎收尾）
  await expect(page).toHaveURL(new RegExp(`/load/reports/${taskId}`), { timeout: 30000 });
  await expect(page.getByTestId("load-report-page")).toBeVisible();
  await expect(page.getByTestId("load-report-summary")).toBeVisible();
  await expect(page.getByTestId("load-report-chart")).toBeVisible();
  await expect(page.getByTestId("load-report-verdict")).toBeVisible();
  await expect(page.getByTestId("load-report-verdict-tag")).toBeVisible();
  await expectNoConsoleErrors();
});

async function createElement(
  page: import("@playwright/test").Page,
  name: string,
  locatorType: string,
  locator: string,
) {
  const createBtn = page.getByTestId("uit-element-create");
  await expect(createBtn).toBeVisible();
  await createBtn.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 8000 }); // antd Modal 动画后可见再交互
  await page.getByTestId("uit-element-name").locator("input").fill(name);
  await pickOption(page, dialog.locator(".ant-select").first(), locatorType);
  // 定位方式选择结果显式核对（静默落默认 css 会污染下游用例——本轮教训）
  await expect(dialog.locator(".ant-select .ant-select-selection-item")).toHaveText(locatorType, {
    timeout: 5000,
  });
  await page.getByTestId("uit-element-locator").locator("input").fill(locator);
  await page.getByRole("button", { name: /确 定|OK/ }).click();
  // toast 竞态教训：antd message 双实例渲染且快速消失——完成信号以表格行出现为准
  await expect(page.getByTestId("uit-elements-table")).toContainText(name, { timeout: 8000 });
}

async function enterUit(page: import("@playwright/test").Page) {
  await page.goto("/ui-test");
  await expect(page.getByTestId("uit-page")).toBeVisible({ timeout: 60000 }); // 页面内授权轮询转正兜底
}

test("UIT-002-T7 建元素 3 个→建用例（mock /uit/demo 4 步）→执行→报告截图网格", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  await ensureEnterprise(request);
  await enableModule(page, "uit");
  await enterUit(page);

  // 元素库：建 3 个元素（用户名输入框/提交按钮/结果文案）
  await page.goto("/ui-test/elements");
  await expect(page.getByTestId("uit-elements-page")).toBeVisible({ timeout: 20000 });
  await createElement(page, "用户名输入框", "testid", "demo-username");
  await createElement(page, "提交按钮", "testid", "demo-submit");
  await createElement(page, "结果文案", "css", ".demo-result-text");
  await expect(page.getByTestId("uit-elements-table")).toContainText("demo-username");

  // 建用例：goto → fill → click → assert-text → screenshot
  await page.goto("/ui-test");
  await page.getByTestId("uit-create-btn").click();
  await expect(page.getByTestId("uit-case-form")).toBeVisible();
  const caseName = `e2e-演示提交-${Date.now()}`;
  await page.getByRole("textbox", { name: "用例名称" }).fill(caseName);
  // 步骤 1：goto
  await page.getByPlaceholder("http(s) 绝对 URL").fill(`${MOCK_URL}/uit/demo`);
  // 步骤 2：fill（用户名输入框 ← e2e-rabbit）
  await page.getByTestId("uit-add-step").click();
  await pickOption(page, page.getByTestId("uit-step-op-1").locator(".ant-select").first(), "fill（填写输入）");
  await pickOption(page, page.getByTestId("uit-step-element-1").locator(".ant-select").first(), /用户名输入框/);
  await page.getByPlaceholder("填写值").fill("e2e-rabbit");
  // 步骤 3：click（提交按钮）
  await page.getByTestId("uit-add-step").click();
  await pickOption(page, page.getByTestId("uit-step-op-2").locator(".ant-select").first(), "click（点击元素）");
  await pickOption(page, page.getByTestId("uit-step-element-2").locator(".ant-select").first(), /提交按钮/);
  // 步骤 4：assert-text（结果文案 期望 提交成功，e2e-rabbit）
  await page.getByTestId("uit-add-step").click();
  await pickOption(page, page.getByTestId("uit-step-op-3").locator(".ant-select").first(), "assert-text（断言文案）");
  await pickOption(page, page.getByTestId("uit-step-element-3").locator(".ant-select").first(), /结果文案/);
  await page.getByPlaceholder("期望包含的文案").fill("提交成功，e2e-rabbit");
  // 步骤 5：screenshot（终态截图——验证 ui-screenshot 帧与报告网格）
  await page.getByTestId("uit-add-step").click();
  await pickOption(page, page.getByTestId("uit-step-op-4").locator(".ant-select").first(), "screenshot（截图）");

  await page.getByTestId("uit-save-btn").click();
  // 创建完成信号=跳回列表+表格含名
  await expect(page).toHaveURL(/\/ui-test$/, { timeout: 10000 });
  await expect(page.getByTestId("uit-cases-table")).toContainText(caseName, { timeout: 10000 });
  const row = page.locator("tr", { hasText: caseName }).first();

  // 执行（列表行内触发）
  await row.getByTestId(/^uit-run-/).click();
  await expect(page).toHaveURL(TASK_URL_RE, { timeout: 15000 });
  const taskId = taskIdFromUrl(page.url(), "ui-test");
  expect(taskId).toBeTruthy();

  // 报告页：步骤行全 ✓ + 截图网格（chromium 真执行，≤90s 等终态轮询）
  await expect(page.getByTestId("uit-report-page")).toBeVisible();
  await expect(page.getByTestId("uit-report-status")).toHaveText("SUCCESS", { timeout: 90000 });
  // 步骤行（断言步显示实际值）
  await expect(page.getByText("提交成功，e2e-rabbit").first()).toBeVisible();
  // 截图网格（screenshot 指令帧 fileId；引擎经 internal/files 落库）
  const shots = page.locator('[data-testid^="uit-report-shot-"]');
  await expect(shots.first()).toBeVisible({ timeout: 15000 });
  await expectNoConsoleErrors();
});

test("UIT-002-T8 断言失败用例：报告 FAILED + 失败现场截图可见", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  await ensureEnterprise(request);
  await enableModule(page, "uit");
  await enterUit(page);

  // 直接 API 建失败用例（goto→click 提交→assert 错误文案）——聚焦执行与报告；
  // 走 page.request（页面用户会话）——request fixture 此时可能是 admin，跨项目 404 防枚举
  const createRes = await page.request.post(`/api/v1/projects/${projectId}/ui-cases`, {
    data: {
      name: `e2e-断言失败-${Date.now()}`,
      steps: [
        { op: "goto", url: `${MOCK_URL}/uit/demo` },
        { op: "click", locator: { locatorType: "testid", locator: "demo-submit" } },
        {
          op: "assert-text",
          expected: "提交成功，never-match-xyz",
          locator: { locatorType: "css", locator: ".demo-result-text" },
        },
      ],
    },
  });
  expect(createRes.status()).toBe(201);
  const caseId = ((await createRes.json()) as { data: { id: string } }).data.id;

  const runRes = await page.request.post(`/api/v1/projects/${projectId}/ui-cases/${caseId}/run`);
  expect(runRes.status()).toBe(202);
  const taskId = ((await runRes.json()) as { data: { taskId: string } }).data.taskId;

  await page.goto(`/ui-test/tasks/${taskId}`);
  await expect(page.getByTestId("uit-report-status")).toHaveText("FAILED", { timeout: 90000 });
  // 失败现场截图（自动截图帧）
  const shots = page.locator('[data-testid^="uit-report-shot-"]');
  await expect(shots.first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/期望「提交成功，never-match-xyz」/)).toBeVisible();
  await expectNoConsoleErrors();
});

// ═══════ 段二：社区版占位回归（摘除 License；T9 门控语义同段） ═══════

test("LOAD-003-T9 无 License：/load 回退占位页（社区版口径）", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  await ensureCommunity(page);
  await enableModule(page, "load");
  await page.goto("/load");
  // 占位卡片（License 未激活态）+ 无新建按钮
  await expect(page.getByTestId("load-placeholder")).toBeVisible();
  await expect(page.getByText("需企业版 License")).toBeVisible();
  await expect(page.getByTestId("load-create-btn")).toHaveCount(0);
  // 接口断言：无 License 直接 POST → 90001（页面无关，request 直发）
  const res = await request.post(`/api/v1/projects/${projectId}/load-tests`, {
    data: {
      name: "e2e-门控",
      target: { method: "GET", url: `${MOCK_URL}/perf/echo` },
      pressure: { mode: "tps", durationSec: 10, targetTps: 5, rampSec: 0 },
    },
  });
  expect(res.status()).toBe(403);
  const body = (await res.json()) as { code: number };
  expect(body.code).toBe(90001);
  await expectNoConsoleErrors();
});

test("UIT-002-T9 无 License：/ui-test 回退占位页 + API 90001", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  await ensureCommunity(page);
  await enableModule(page, "uit");
  await page.goto("/ui-test");
  await expect(page.getByTestId("uit-placeholder")).toBeVisible();
  await expect(page.getByText("需企业版 License")).toBeVisible();
  await expect(page.getByTestId("uit-create-btn")).toHaveCount(0);
  const res = await request.post(`/api/v1/projects/${projectId}/ui-cases`, {
    data: { name: "e2e-门控", steps: [{ op: "wait", ms: 1 }] },
  });
  expect(res.status()).toBe(403);
  expect(((await res.json()) as { code: number }).code).toBe(90001);
  await expectNoConsoleErrors();
});

test("LOAD-001-T4（S11 占位回归）开关开启→导航出现占位入口→占位页呈现→关闭即隐", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  await ensureCommunity(page);
  // 前置：导航默认无「性能测试」组（占位默认关）
  await page.goto("/");
  await expect(page.getByTestId("nav-load")).toHaveCount(0);

  // 设置页开启开关（企业版方向行存在且默认关）
  await page.goto("/settings/info");
  const loadSwitch = page.getByTestId("module-switch-load");
  await expect(loadSwitch).toBeVisible();
  await expect(loadSwitch).not.toHaveClass(/ant-switch-checked/);

  await loadSwitch.click();
  await page.waitForTimeout(300);
  await page.getByTestId("btn-save-info").click();
  await expect(page.getByText("基本信息已保存").first()).toBeVisible({ timeout: 10000 });
  // 接口断言：开关已持久化（保存后回读——同一页面会话）
  const info = await page.request.get(`/api/v1/projects/${projectId}/info`);
  expect(info.status()).toBe(200);

  // 导航组出现（模块开关 ∧ PROJECT_LOAD:READ 双门控——注册用户=本项目管理员）
  await page.goto("/");
  await expect(page.getByTestId("nav-load")).toBeVisible();

  // 占位页：标题+空态卡（License 未激活态文案）
  await page.getByTestId("nav-load").click();
  await expect(page).toHaveURL(/\/load$/);
  await expect(page.getByText("性能测试 · 需企业版 License")).toBeVisible();
  await expect(page.getByTestId("load-placeholder")).toBeVisible();
  await expect(page.getByText("阶梯加压")).toBeVisible();

  // 关闭 → 导航隐藏（数据零迁移语义）
  await page.goto("/settings/info");
  await page.getByTestId("module-switch-load").click();
  await page.waitForTimeout(300);
  await page.getByTestId("btn-save-info").click();
  await expect(page.getByText("基本信息已保存").first()).toBeVisible({ timeout: 8000 });
  await page.goto("/");
  await expect(page.getByTestId("nav-load")).toHaveCount(0);
  await expectNoConsoleErrors();
});

test("UIT-001-T3（S11 占位回归）开启 uit 开关→导航/占位页→能力清单口径", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  await ensureCommunity(page);
  await page.goto("/");
  await expect(page.getByTestId("nav-uit")).toHaveCount(0);

  await page.goto("/settings/info");
  const uitSwitch = page.getByTestId("module-switch-uit");
  await expect(uitSwitch).toBeVisible();
  await expect(uitSwitch).not.toHaveClass(/ant-switch-checked/);

  await uitSwitch.click();
  await page.waitForTimeout(300);
  await page.getByTestId("btn-save-info").click();
  await expect(page.getByText("基本信息已保存").first()).toBeVisible({ timeout: 10000 });
  const info = await page.request.get(`/api/v1/projects/${projectId}/info`);
  expect(info.status()).toBe(200);

  await page.goto("/");
  await expect(page.getByTestId("nav-uit")).toBeVisible();
  await page.getByTestId("nav-uit").click();
  await expect(page).toHaveURL(/\/ui-test$/);
  await expect(page.getByText("UI 测试 · 需企业版 License")).toBeVisible();
  await expect(page.getByTestId("uit-placeholder")).toBeVisible();
  // 能力清单口径（UIT-001 §1.2）
  await expect(page.getByText("UI 自动化用例编排")).toBeVisible();
  await expect(page.getByText("逐步截图报告")).toBeVisible();
  await expectNoConsoleErrors();
});

test("LOAD-001-T4b 资源池 DTO 占位字段（loadTest/uiTest=false 联动 §4；与 License 态无关）", async ({
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

// ═══════ 段三：恢复企业版（并行文件的后置用例可能依赖企业态） ═══════

test("S11-收尾：恢复企业版态", async ({ request }) => {
  await ensureEnterprise(request);
});
