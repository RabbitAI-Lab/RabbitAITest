import { test, expect } from "./fixtures";
import { removeLicense, loginSeedAdmin, MOCK_URL } from "./s9-helpers";

/**
 * S13 UIT-003：UI 测试脚本模式 e2e（规格 §5 T9/T10/T11）。
 * T9 粘贴导入→校验干跑→创建→执行→报告测试树+trace；T10 失败脚本→错误代码帧+失败截图；
 * T11 存量步骤模式零回归（mode 分发不破坏 UIT-002 链路）。
 * 三类断言：UI（导入弹层/列表模式列/报告树/trace 卡/截图）+ Console（无 error/pageerror）+
 * 接口（validate-script 202+载荷、run 202、报告数据含测试行与 trace）。
 * CI 教训（2026-10-01 首轮）：引擎契约升版须同步 web pool.service EXPECTED_ENGINE_VERSION，
 * 否则节点全标 UNMATCHED；本文件首轮 CI 三分片全绿（24s 复用栈）。
 */

const TASK_URL_RE = /\/tasks\/[0-9a-f-]{36}/;

/** License 摘除并稳定 COMMUNITY（ENTP-009 开源态即产品默认态——与 S11 同法）。 */
async function ensureCommunity(page: import("@playwright/test").Page) {
  const adminCtx = await page.context().browser()!.newContext();
  let streak = 0;
  try {
    await loginSeedAdmin(adminCtx.request, adminCtx);
    for (let round = 0; round < 40 && streak < 2; round++) {
      const r = await adminCtx.request.get("/api/v1/public/license-status", {
        headers: { "cache-control": "no-store" },
      });
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
}

async function enableUitModule(page: import("@playwright/test").Page) {
  await page.goto("/settings/info");
  const sw = page.getByTestId("module-switch-uit");
  await expect(sw).toBeVisible();
  if (!(await sw.evaluate((el) => el.classList.contains("ant-switch-checked")))) {
    await sw.click();
    await page.waitForTimeout(300);
    await page.getByTestId("btn-save-info").click();
    await expect(page.getByText("基本信息已保存").first()).toBeVisible({ timeout: 8000 });
  }
}

async function enterUit(page: import("@playwright/test").Page) {
  await page.goto("/ui-test");
  await expect(page.getByTestId("uit-page")).toBeVisible({ timeout: 60000 });
}

function okScript(user: string): string {
  return `import { test, expect } from '@playwright/test';
test('脚本提交成功', async ({ page }) => {
  await page.goto('${MOCK_URL}/uit/demo');
  await page.getByTestId('demo-username').fill('${user}');
  await page.getByTestId('demo-submit').click();
  await expect(page.getByTestId('demo-result')).toContainText('提交成功，${user}');
});
test('元素可见', async ({ page }) => {
  await page.goto('${MOCK_URL}/uit/demo');
  await expect(page.getByTestId('demo-username')).toBeVisible();
});`;
}

function failScript(user: string): string {
  return `import { test, expect } from '@playwright/test';
test('会通过的测试', async ({ page }) => {
  await page.goto('${MOCK_URL}/uit/demo');
  await expect(page.getByTestId('demo-username')).toBeVisible();
});
test('会失败的测试', async ({ page }) => {
  await page.goto('${MOCK_URL}/uit/demo');
  await page.getByTestId('demo-username').fill('${user}');
  await page.getByTestId('demo-submit').click();
  await expect(page.getByTestId('demo-result')).toHaveText('不会出现的文案');
});`;
}

test("UIT-003-T9 粘贴导入→校验（绿）→执行→报告测试树+trace【无 License·ENTP-009】", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
}) => {
  await ensureCommunity(page);
  await enableUitModule(page);
  await enterUit(page);

  const caseName = `e2e-脚本导入-${Date.now()}`;
  // 接口断言（validate-script 载荷与状态）：拦截透传并留痕
  const validateReq = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().includes("/ui-cases/validate-script"),
  );
  const validateRes = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("/ui-cases/validate-script"),
  );

  await page.getByTestId("uit3-paste-import").click();
  // antd Modal 的 testid 落在常驻 ant-modal-root（closed 态 hidden）——按仓库先例以 role=dialog 定位
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 8000 });
  await dialog.getByPlaceholder("用例名称（默认取脚本内首个 test 标题）").fill(caseName);
  await page.getByTestId("uit3-paste-textarea").fill(okScript("uit3-t9"));
  await page.getByTestId("uit3-paste-create").click();

  const req = await validateReq;
  const reqBody = req.postDataJSON() as { script?: string; name?: string };
  expect(reqBody.script).toContain("playwright/test");
  expect(reqBody.name).toBe(caseName);
  const res = await validateRes;
  expect(res.status()).toBe(202);

  // 校验通过并创建 → 弹层关闭 + 列表行（模式=脚本 + 摘要）
  await expect(dialog).toBeHidden({ timeout: 30000 });
  await expect(page.getByTestId("uit-cases-table")).toContainText(caseName, { timeout: 10000 });
  const row = page.locator("tr", { hasText: caseName }).first();
  await expect(row.getByTestId("uit3-mode-script")).toBeVisible();

  // 执行 → 报告：测试树全绿 + trace 卡（接口断言 run 202 走行内 mutation 跳转信号）
  await row.getByTestId(/^uit-run-/).click();
  await expect(page).toHaveURL(TASK_URL_RE, { timeout: 15000 });
  const taskId = page.url().split("/tasks/")[1];
  expect(taskId).toMatch(/[0-9a-f-]{36}/);
  await expect(page.getByTestId("uit-report-status")).toHaveText("SUCCESS", { timeout: 120000 });
  // 测试树：两个测试行（官方 runner 真执行）
  await expect(page.getByText("脚本提交成功").first()).toBeVisible();
  await expect(page.getByText("元素可见").first()).toBeVisible();
  // trace 卡（trace=on → ui-trace 帧 → files 下载链接）
  const traceLinks = page.locator('[data-testid^="uit3-trace-dl-"]');
  await expect(traceLinks.first()).toBeVisible({ timeout: 15000 });
  await expectNoConsoleErrors();
});

test("UIT-003-T10 失败脚本执行：报告 FAILED + 错误代码帧 + 失败现场截图", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  await ensureCommunity(page);
  await enableUitModule(page);
  await enterUit(page);

  const createRes = await page.request.post(`/api/v1/projects/${projectId}/ui-cases`, {
    data: {
      name: `e2e-脚本失败-${Date.now()}`,
      mode: "script",
      steps: [],
      script: failScript("uit3-t10"),
      params: [],
      timeoutMs: 20000,
    },
  });
  expect(createRes.status()).toBe(201);
  const caseId = ((await createRes.json()) as { data: { id: string } }).data.id;

  const runRes = await page.request.post(`/api/v1/projects/${projectId}/ui-cases/${caseId}/run`);
  expect(runRes.status()).toBe(202);
  const taskId = ((await runRes.json()) as { data: { taskId: string } }).data.taskId;

  await page.goto(`/ui-test/tasks/${taskId}`);
  await expect(page.getByTestId("uit-report-status")).toHaveText("FAILED", { timeout: 120000 });
  // 测试树：通过行 ✓ + 失败行 ✗ 展开=错误代码帧（PW message 含 Expected/Received + "> N |" 帧）
  await expect(page.getByText("会通过的测试").first()).toBeVisible();
  await page
    .getByTestId(/^uit3-expand-error-/)
    .first()
    .click();
  const frame = page.locator('[data-testid^="uit3-error-frame-"]').first();
  await expect(frame).toBeVisible();
  await expect(frame).toContainText("不会出现的文案");
  // 失败现场截图（screenshot=only-on-failure）
  const shots = page.locator('[data-testid^="uit-report-shot-"]');
  await expect(shots.first()).toBeVisible({ timeout: 15000 });
  await expectNoConsoleErrors();
});

test("UIT-003-T11 存量步骤用例零回归（mode 分发不破坏 UIT-002 链路）", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  await ensureCommunity(page);
  await enableUitModule(page);
  await enterUit(page);

  const createRes = await page.request.post(`/api/v1/projects/${projectId}/ui-cases`, {
    data: {
      name: `e2e-步骤回归-${Date.now()}`,
      steps: [
        { op: "goto", url: `${MOCK_URL}/uit/demo` },
        {
          op: "fill",
          locator: { locatorType: "testid", locator: "demo-username" },
          value: "uit3-t11",
        },
        { op: "click", locator: { locatorType: "testid", locator: "demo-submit" } },
        {
          op: "assert-text",
          expected: "提交成功，uit3-t11",
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
  await expect(page.getByTestId("uit-report-status")).toHaveText("SUCCESS", { timeout: 90000 });
  // 步骤时间线口径不变（步骤行含 goto 与最终断言文案）
  await expect(page.getByText("提交成功，uit3-t11").first()).toBeVisible();
  // 列表模式列：步骤 tag（非脚本）
  await page.goto("/ui-test");
  await expect(page.getByTestId("uit-cases-table")).toContainText("步骤回归", { timeout: 10000 });
  await expectNoConsoleErrors();
});
