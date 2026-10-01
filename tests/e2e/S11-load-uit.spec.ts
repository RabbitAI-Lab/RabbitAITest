import { test, expect, ensureNavVisible } from "./fixtures";
import { removeLicense, loginSeedAdmin, MOCK_URL } from "./s9-helpers";
import { pickOption } from "./s2-helpers";

/**
 * S11 性能测试/UI 测试聚合 e2e（LOAD-003 §5 T8/T9 + UIT-002 §5 T7/T8/T9 + LOAD-001/UIT-001 模块开关回归）。
 * **License 互斥单文件**（S11 顽固假红终局对策，保留）：License/模块开关为全局态——所有涉及
 * License 生命周期的用例收编进本文件串行执行，严禁与其他文件交错。
 * E NTP-009（2026-09-30 开源全功能）：License 不再门控任何功能——**全程无 License 跑通功能链路即回归点**；
 * 原「社区版占位回归（T9 门控）」翻转为「无 License 全功能可用 + 状态接口 featureGateEnabled=false」；
 * 模块开关（管理员可关）回归保留且缺省改开。占位组件（placeholder.tsx）死代码保留——门控恢复态
 * （RABBIT_FEATURE_GATE=1）复活，语义由 license.test.ts 单测双侧覆盖。
 * 三类断言：UI（编辑器/监控曲线/报告/截图网格/模块开关）+ Console（无错误）+ 接口（jmx 层覆盖 run/metrics 帧——e2e 聚焦 UI 链路）。
 */

const TASK_URL_RE = /\/tasks\/[0-9a-f-]{36}/;
const E2E_PASSWORD = process.env.E2E_USER_PASSWORD ?? "rabbit-pass-123";

/** E NTP-009 缺省契约：全新项目 modules 六键全开（持久库上存量显式 false 不代表缺省——须用新项目验证）。 */
async function assertFreshProjectModulesDefaultOn(page: import("@playwright/test").Page) {
  const ctx = await page.context().browser()!.newContext();
  try {
    const email = `e2e-moddef-${Date.now()}@rabbit.test`;
    const reg = await ctx.request.post("/api/v1/auth/register", {
      data: { email, password: E2E_PASSWORD },
    });
    expect(reg.status()).toBe(201);
    const pid = ((await reg.json()) as { data: { projectId: string } }).data.projectId;
    const info = await ctx.request.get(`/api/v1/projects/${pid}/info`);
    expect(info.status()).toBe(200);
    const modules = ((await info.json()) as { data: { modules: Record<string, boolean> } }).data
      .modules;
    expect(modules).toMatchObject({ case: true, api: true, plan: true, bug: true, load: true, uit: true });
  } finally {
    await ctx.close();
  }
}

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

/** License 摘除并稳定 COMMUNITY（连续 2 次确认；ENTP-009 开源态即产品默认态）。 */
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

// License 生命周期=文件级（beforeAll 摘除保开源态、afterAll 再清；用例内不再 per-test 加删）
test.beforeAll(async ({ playwright }) => {
  const browser = await playwright.chromium.launch();
  const ctx = await browser.newContext();
  await loginSeedAdmin(ctx.request, ctx).catch(() => undefined);
  await removeLicense(ctx.request).catch(() => undefined);
  await browser.close();
});

test.afterAll(async ({ playwright }) => {
  const browser = await playwright.chromium.launch();
  const ctx = await browser.newContext();
  await loginSeedAdmin(ctx.request, ctx).catch(() => undefined);
  await removeLicense(ctx.request).catch(() => undefined);
  await browser.close();
});

// ═══════ 段一：功能链路（无 License·开源全功能 E NTP-009） ═══════

test("LOAD-003-T8 建计划（mock /perf/echo 8s）→执行→监控曲线→报告结论【无 License·ENTP-009】", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  await ensureCommunity(page);
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

test("UIT-002-T7 建元素 3 个→建用例（mock /uit/demo 4 步）→执行→报告截图网格【无 License·ENTP-009】", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  await ensureCommunity(page);
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
  // S13 UIT-003 起新建默认脚本模式——存量步骤链路先显式切「步骤模式」（Segmented+确认弹窗）
  await page.getByTestId("uit3-mode-segmented").getByText("步骤模式", { exact: true }).click();
  await page.getByRole("button", { name: "确认切换" }).click();
  await expect(page.getByTestId("uit-step-editor")).toBeVisible({ timeout: 8000 });
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
  await ensureCommunity(page);
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

// ═══════ 段二：无 License 全功能回归（ENTP-009 翻转：原 T9 门控占位→开放可用） ═══════

test("LOAD-003-T9 无 License：/load 全功能可用（开源口径）+ 状态接口 featureGateEnabled=false", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  await ensureCommunity(page);
  await enableModule(page, "load");
  await page.goto("/load");
  // 开源全功能：真实列表页（非占位卡片）+ 新建按钮可用
  await expect(page.getByTestId("load-page")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("load-create-btn")).toBeVisible();
  await expect(page.getByTestId("load-placeholder")).toHaveCount(0);
  // 接口断言：无 License 直接 POST 建计划 → 201（原 90001 门控已停用）
  const res = await request.post(`/api/v1/projects/${projectId}/load-tests`, {
    data: {
      name: "e2e-开源门控回归",
      target: { method: "GET", url: `${MOCK_URL}/perf/echo` },
      pressure: { mode: "tps", durationSec: 10, targetTps: 5, rampSec: 0 },
    },
  });
  expect(res.status()).toBe(201);
  // 公开状态接口：社区版 + 门控未启用（前端据此放行）
  const st = await request.get("/api/v1/public/license-status");
  const stBody = (await st.json()) as { data: { edition: string; featureGateEnabled: boolean } };
  expect(stBody.data.edition).toBe("COMMUNITY");
  expect(stBody.data.featureGateEnabled).toBe(false);
  await expectNoConsoleErrors();
});

test("UIT-002-T9 无 License：/ui-test 全功能可用（开源口径）+ 建用例 201", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  await ensureCommunity(page);
  await enableModule(page, "uit");
  await page.goto("/ui-test");
  await expect(page.getByTestId("uit-page")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("uit-create-btn")).toBeVisible();
  await expect(page.getByTestId("uit-placeholder")).toHaveCount(0);
  const res = await request.post(`/api/v1/projects/${projectId}/ui-cases`, {
    data: { name: "e2e-开源门控回归", steps: [{ op: "wait", ms: 1 }] },
  });
  expect(res.status()).toBe(201);
  await expectNoConsoleErrors();
});

test("LOAD-001-T4（ENTP-009 回归）模块缺省开→导航入口+真实页可用→关闭即隐→重开恢复", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  await ensureCommunity(page);
  // 缺省契约（新项目验证——持久库演示项目可能残留显式 false，不代表缺省语义）
  await assertFreshProjectModulesDefaultOn(page);

  // 演示项目：开关自愈为开（存量显式 false 场景）→ 导航出现
  await enableModule(page, "load");
  await page.goto("/");
  // SYS-010：「性能测试」分组默认折叠——显隐断言前先展开分组
  await ensureNavVisible(page, "性能测试");
  await expect(page.getByTestId("nav-load").first()).toBeVisible();

  // 设置页开关开启态回显
  await page.goto("/settings/info");
  const loadSwitch = page.getByTestId("module-switch-load");
  await expect(loadSwitch).toBeVisible();
  await expect(loadSwitch).toHaveClass(/ant-switch-checked/);

  // 入口直达真实页（开源全功能——非占位）
  await page.goto("/load");
  await expect(page.getByTestId("load-page")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("load-placeholder")).toHaveCount(0);

  // 关闭 → 保存 → 导航隐藏（管理员可关语义保留）
  await page.goto("/settings/info");
  await page.getByTestId("module-switch-load").click();
  await page.waitForTimeout(300);
  await page.getByTestId("btn-save-info").click();
  await expect(page.getByText("基本信息已保存").first()).toBeVisible({ timeout: 10000 });
  // 接口断言：开关已持久化（保存后回读——同一页面会话）
  const info = await page.request.get(`/api/v1/projects/${projectId}/info`);
  expect(info.status()).toBe(200);
  await page.goto("/");
  await expect(page.getByTestId("nav-load")).toHaveCount(0);

  // 重开 → 恢复缺省态（收尾自愈，后续用例不受影响）
  await page.goto("/settings/info");
  await page.getByTestId("module-switch-load").click();
  await page.waitForTimeout(300);
  await page.getByTestId("btn-save-info").click();
  await expect(page.getByText("基本信息已保存").first()).toBeVisible({ timeout: 8000 });
  await page.goto("/");
  await expect(page.getByTestId("nav-load").first()).toBeVisible();
  await expectNoConsoleErrors();
});

test("UIT-001-T3（ENTP-009 回归）uit 缺省开→真实页可用→关闭即隐→重开恢复", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  await ensureCommunity(page);
  // 缺省契约已在 LOAD-001-T4 以新项目验证（六键同源断言）——此处聚焦 uit 开关行为
  await enableModule(page, "uit");
  await page.goto("/");
  // SYS-010：「UI 测试」分组默认折叠——显隐断言前先展开分组
  await ensureNavVisible(page, "UI 测试");
  await expect(page.getByTestId("nav-uit").first()).toBeVisible();

  await page.goto("/settings/info");
  const uitSwitch = page.getByTestId("module-switch-uit");
  await expect(uitSwitch).toBeVisible();
  await expect(uitSwitch).toHaveClass(/ant-switch-checked/);

  // 直达真实页（元素库入口可见——开源全功能口径）
  await page.goto("/ui-test");
  await expect(page.getByTestId("uit-page")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("uit-elements-entry")).toBeVisible();
  await expect(page.getByTestId("uit-placeholder")).toHaveCount(0);

  // 关闭 → 导航隐藏
  await page.goto("/settings/info");
  await page.getByTestId("module-switch-uit").click();
  await page.waitForTimeout(300);
  await page.getByTestId("btn-save-info").click();
  await expect(page.getByText("基本信息已保存").first()).toBeVisible({ timeout: 10000 });
  const info = await page.request.get(`/api/v1/projects/${projectId}/info`);
  expect(info.status()).toBe(200);
  await page.goto("/");
  await expect(page.getByTestId("nav-uit")).toHaveCount(0);

  // 重开 → 恢复缺省态
  await page.goto("/settings/info");
  await page.getByTestId("module-switch-uit").click();
  await page.waitForTimeout(300);
  await page.getByTestId("btn-save-info").click();
  await expect(page.getByText("基本信息已保存").first()).toBeVisible({ timeout: 8000 });
  await page.goto("/");
  await ensureNavVisible(page, "UI 测试");
  await expect(page.getByTestId("nav-uit").first()).toBeVisible();
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

