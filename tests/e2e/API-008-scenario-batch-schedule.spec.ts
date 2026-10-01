import { test, expect, navFromHome } from "./fixtures";
import { bundle, createApiDef, createMockRule, getMockUrl, pollTask } from "./s2-helpers";
import { createScenario, customStep, defaultScenarioModuleId, saveSteps } from "./s3-helpers";
import { MOCK_BASE } from "./env";

/**
 * API-008 场景批量执行与定时任务（规格：docs/sprint-3-scenario-automation/API-008-scenario-execution-batch.md）。
 * 三类断言：UI（批量弹窗/任务中心 cron Tab）+ Console + 接口（executeBatch payload/报告 items/cron 422）。
 */

test("API-008-01 批量执行：勾选 2 场景→弹窗串行→跳任务中心高亮→报告 2 执行项", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const pid = authedPage.projectId;
  const uniq = `S8${Date.now() % 1e7}`;
  const mockUrl = `${MOCK_BASE}/hello`;

  const a = await createScenario(request, pid, { name: `批量A-${uniq}` });
  const b = await createScenario(request, pid, { name: `批量B-${uniq}` });
  await saveSteps(request, pid, a.id, [customStep("a", mockUrl)]);
  await saveSteps(request, pid, b.id, [customStep("b", mockUrl)]);

  await navFromHome(page, "接口场景");
  // 勾选两行
  await page.getByTestId(`scenario-row-${a.num}`).locator('input[type="checkbox"]').check();
  await page.getByTestId(`scenario-row-${b.num}`).locator('input[type="checkbox"]').check();
  await page.getByTestId("btn-batch-exec").click();

  // 弹窗：模式=串行 + 失败停止默认关 + 执行（接口断言 payload）
  await expect(page.getByText(/批量执行 · 2 个场景/)).toBeVisible();
  const fired = page.waitForResponse("**/api/v1/projects/*/scenarios/execute");
  await page.getByRole("button", { name: "执 行", exact: true }).click();
  const res = await fired;
  expect(res.status()).toBe(201);
  const payload = res.request().postDataJSON() as {
    scenarioIds: string[];
    mode: string;
    stopOnFail: boolean;
  };
  expect(payload.scenarioIds).toHaveLength(2);
  expect(payload.mode).toBe("serial");
  expect(payload.stopOnFail).toBe(false);

  // 跳任务中心（focus 高亮行 + scenario 类型标签）
  await expect(page.getByTestId("task-center")).toBeVisible();
  await expect(
    page.getByText("批量A-" + uniq).or(page.locator('[data-testid^="task-row-"]').first()),
  ).toBeVisible();

  // 接口断言：报告 2 执行项全成功
  const body = (await res.json()) as { data: { taskId: string } };
  const final = await pollTask(request, pid, body.data.taskId);
  expect(final.status).toBe("SUCCESS");
  const rep = await request.get(`/api/v1/projects/${pid}/reports/${body.data.taskId}`);
  const detail = (await rep.json()) as {
    data: { summary: { total: number; passed: number }; items: unknown[] };
  };
  expect(detail.data.summary.total).toBe(2);
  expect(detail.data.summary.passed).toBe(2);
  expect(detail.data.items).toHaveLength(2);

  await expectNoConsoleErrors();
});

test("API-008-02 定时任务：cron Tab 新建→列表→启停→立即执行→cron 非法 422→删除", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const pid = authedPage.projectId;
  const uniq = `S8${Date.now() % 1e7}`;
  const sc = await createScenario(request, pid, { name: `定时场景-${uniq}` });

  // UI：任务中心 → 定时任务 Tab（S2 空态已被 S3 数据源替换）
  await navFromHome(page, "任务中心");
  await page.getByTestId("task-tab-cron").click();
  await expect(page.getByTestId("schedule-panel")).toBeVisible();

  // 新建抽屉：名称 + cron + 场景多选
  await page.getByTestId("btn-new-schedule").click();
  await page.getByTestId("input-schedule-name").fill(`每日冒烟-${uniq}`);
  await page.getByTestId("input-schedule-cron").fill("0 9 * * *");
  await page.getByText("每天 09:00").first().click(); // 收起说明并确认人话展示
  await page.getByTestId("select-schedule-scenarios").click();
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText(`定时场景-${uniq}`)
    .first()
    .click();
  await page.keyboard.press("Escape");
  const created = page.waitForResponse("**/api/v1/projects/*/scenario-schedules");
  await page.getByTestId("btn-save-schedule").click();
  const res = await created;
  expect(res.status()).toBe(201);
  const createdData = (await res.json()) as { data: { id: string } };
  const schId8 = createdData.data.id.slice(0, 8);

  // 列表呈现（名称 + cron 人话）
  await expect(page.getByTestId(`schedule-name-${schId8}`)).toHaveText(`每日冒烟-${uniq}`);
  await expect(page.getByTestId("schedule-panel").getByText("每天 09:00")).toBeVisible();

  // 接口断言：cron 非法（每分钟 < 5 分钟）→ 422 code 50005
  const bad = await request.post(`/api/v1/projects/${pid}/scenario-schedules`, {
    data: { name: "bad", cron: "* * * * *", scenarioIds: [sc.id] },
  });
  expect(bad.status()).toBe(422);
  expect(((await bad.json()) as { code: number }).code).toBe(50005);

  // 启停二态：停用 → 文案「已停用 · 不触发」→ 启用恢复。
  // 状态翻转必须等 toggle 响应落库（PR#41 main 假红实证：cron 人话文本在停用态下同样命中，
  // 弱文本断言放行后立即执行撞上 enabled=false → fireSchedule 返回 201+skipped 无 taskId）；
  // 慢 runner 上 PATCH 落库慢于下一行 fetch 时必现。
  await page.getByTestId(`schedule-toggle-${schId8}`).click();
  await expect(page.getByText("已停用 · 不触发")).toBeVisible();
  const reEnable = page.waitForResponse("**/api/v1/projects/*/scenario-schedules/*/toggle");
  await page.getByTestId(`schedule-toggle-${schId8}`).click();
  const reEnableRes = await reEnable;
  expect(reEnableRes.status()).toBe(200);
  await expect(page.getByText("已停用 · 不触发")).toBeHidden();
  await expect(page.getByTestId("schedule-panel").getByText("每天 09:00")).toBeVisible();

  // 立即执行（接口断言返回 taskId；skipped 时带原因失败而非 undefined 裸断言）
  const runRes = await request.post(
    `/api/v1/projects/${pid}/scenario-schedules/${createdData.data.id}/run`,
    { data: {} },
  );
  expect(runRes.status()).toBe(201);
  const runBody = (await runRes.json()) as { data: { taskId?: string; skipped?: string } };
  expect(runBody.data.taskId, `立即执行被跳过：${runBody.data.skipped ?? "(未知)"}`).toBeTruthy();

  // 删除
  await page.getByTestId("schedule-panel").getByRole("button", { name: "删除" }).click();
  await page.getByRole("button", { name: "删 除", exact: true }).click();
  await expect(page.getByText("已删除")).toBeVisible();

  await expectNoConsoleErrors();
});
