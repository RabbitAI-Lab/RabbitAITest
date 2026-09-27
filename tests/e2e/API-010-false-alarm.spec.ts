import { test, expect, navFromHome } from "./fixtures";
import { bundle, createApiDef, createMockRule, getMockUrl, pollTask } from "./s2-helpers";
import { createScenario, customStep, executeScenario, saveSteps } from "./s3-helpers";

/**
 * API-010 误报规则（规格：docs/sprint-3-scenario-automation/API-010-false-alarm-rules.md）。
 * 三类断言：UI（规则页 CRUD/启停、报告误报徽标与单列卡）+ Console + 接口（matcher AND/改判 FAKE_ERROR/停用对照）。
 */

test("API-010-01 误报规则 CRUD 与启停（UI 表格 + 抽屉匹配器）", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const pid = authedPage.projectId;
  const uniq = `SA${Date.now() % 1e7}`;
  const ruleName = `三方网关抖动-${uniq}`;

  await navFromHome(page, "接口场景");
  await page.getByTestId("btn-goto-false-alarm").click();
  await expect(page.getByTestId("fa-rules-table")).toBeVisible();

  // 新建（Drawer：状态码 502 + 体包含 known-issue 的 AND 匹配器）
  await page.getByTestId("btn-new-fa-rule").click();
  await page.getByTestId("input-fa-name").fill(ruleName);
  await page.getByTestId("switch-fa-status").click();
  await page.getByTestId("input-fa-body").fill("known-issue");
  const created = page.waitForResponse("**/api/v1/projects/*/false-alarm-rules");
  await page.getByTestId("btn-save-fa-rule").click();
  const res = await created;
  expect(res.status()).toBe(201);
  const payload = res.request().postDataJSON() as { name: string; matcher: { status?: number; bodyContains?: string }; enabled: boolean };
  expect(payload.name).toBe(ruleName);
  expect(payload.matcher.status).toBe(502);
  expect(payload.matcher.bodyContains).toBe("known-issue");
  const createdData = (await res.json()) as { data: { id: string } };
  const id8 = createdData.data.id.slice(0, 8);

  // UI 断言：表格行呈现匹配器文本
  await expect(page.getByTestId(`fa-rule-name-${id8}`)).toHaveText(ruleName);
  await expect(page.getByTestId("fa-rules-table").getByText(/状态码 = 502/)).toBeVisible();
  await expect(page.getByTestId("fa-rules-table").getByText(/known-issue/)).toBeVisible();

  // 启停二态：停用（update 端点返回 {id}，enabled 从列表回读断言）
  const toggled = page.waitForResponse(`**/api/v1/projects/*/false-alarm-rules/*`);
  await page.getByTestId(`fa-rule-toggle-${id8}`).click();
  await toggled;
  const afterToggle = await request.get(`/api/v1/projects/${pid}/false-alarm-rules`);
  const listData = (await afterToggle.json()) as { data: { list: { id: string; enabled: boolean }[] } };
  expect(listData.data.list.find((x) => x.id === createdData.data.id)?.enabled).toBe(false);

  // 删除（Popconfirm）
  await page.getByTestId("fa-rules-table").getByRole("button", { name: "删除" }).click();
  await page.getByRole("button", { name: "删 除", exact: true }).click();
  await expect(page.getByText("规则已删除")).toBeVisible();

  await expectNoConsoleErrors();
});

test("API-010-02 误报改判链路：失败场景命中耗时规则→item=FAKE_ERROR 徽标+单列统计；停用后重跑 FAILED", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const pid = authedPage.projectId;
  const uniq = `SA${Date.now() % 1e7}`;
  const mockUrl = "http://127.0.0.1:4001/hello";

  // 规则（体包含 hello：内置端点响应必命中）+ 失败场景（断言故意 eq 500）
  const rule = await request.post(`/api/v1/projects/${pid}/false-alarm-rules`, {
    data: { name: `响应体规则-${uniq}`, matcher: { bodyContains: "hello" }, enabled: true, description: "" },
  });
  const ruleId = ((await rule.json()) as { data: { id: string } }).data.id;
  const sc = await createScenario(request, pid, { name: `误报场景-${uniq}` });
  await saveSteps(request, pid, sc.id, [
    customStep("必败", mockUrl, [{ kind: "status_code", path: "", op: "eq", expected: "500" }]),
  ]);

  // 执行①：命中 → FAKE_ERROR（接口断言改判 + summary.fakeError=1）
  const task1 = await executeScenario(request, pid, sc.id);
  await pollTask(request, pid, task1);
  const rep1 = await request.get(`/api/v1/projects/${pid}/reports/${task1}`);
  const d1 = (await rep1.json()) as { data: { items: { itemId: string; status: string; fakeAlarmHits?: { ruleName: string }[] }[]; summary: { failed: number; fakeError: number } } };
  expect(d1.data.items[0]!.status).toBe("FAKE_ERROR");
  expect(d1.data.items[0]!.fakeAlarmHits![0]!.ruleName).toContain("响应体规则");
  expect(d1.data.summary.fakeError).toBe(1);
  expect(d1.data.summary.failed).toBe(0);

  // UI：报告误报徽标（规则名）+ 误报单列卡 = 1
  await page.goto(`/reports/${task1}`);
  await expect(page.getByTestId("card-fake")).toContainText("1");
  const badge = page.locator('[data-testid^="fake-badge-"]').first();
  await expect(badge).toBeVisible();
  await expect(badge).toContainText("误报");

  // 停用规则 → 重跑不再标记（FAILED，fakeError=0）
  await request.put(`/api/v1/projects/${pid}/false-alarm-rules/${ruleId}`, {
    data: { name: `响应体规则-${uniq}`, matcher: { bodyContains: "hello" }, enabled: false, description: "" },
  });
  const task2 = await executeScenario(request, pid, sc.id);
  await pollTask(request, pid, task2);
  const rep2 = await request.get(`/api/v1/projects/${pid}/reports/${task2}`);
  const d2 = (await rep2.json()) as { data: { items: { status: string }[]; summary: { fakeError: number } } };
  expect(d2.data.items[0]!.status).toBe("FAILED");
  expect(d2.data.summary.fakeError).toBe(0);

  await expectNoConsoleErrors();
});
