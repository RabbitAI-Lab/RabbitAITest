import { test, expect, navFromHome } from "./fixtures";
import {
  bundle,
  createApiCase,
  createApiDef,
  createEnv,
  executeCases,
  pollTask,
} from "./s2-helpers";

/**
 * SYS-006 任务中心（规格：docs/sprint-2-api-core/SYS-006-task-center.md）。
 * 覆盖：本项目 Tab 行（类型徽标/进度/终态操作两态）、重跑生成「重跑自」新行、
 * 全部项目 Tab 切换、定时任务空态；状态筛选 FAILED（UI 行数 + 接口 query）。
 * 三类断言：UI + Console + 接口（exec-tasks 列表 query、rerun 生成新 taskId）。
 */

test("SYS-006-01 任务主链路：本项目行→终态操作两态→重跑「重跑自」→全部项目 Tab→定时空态", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `S6${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;

  // 数据准备：3 用例（2 成功 1 失败）批量执行 + 1 个成功任务（对照操作两态）
  const envId = await createEnv(request, projectId, `任务环境-${uniq}`);
  const def = await createApiDef(request, projectId, {
    name: `任务定义-${uniq}`,
    path: "/hello",
    request: bundle("GET", "${base}/hello"),
  });
  const caseIds: string[] = [];
  for (const [i, expected] of ["200", "200", "500"].entries()) {
    const c = await createApiCase(request, projectId, def.id, {
      name: `任务用例${i + 1}-${uniq}`,
      request: bundle("GET", "${base}/hello", {
        asserts: [{ kind: "status_code", path: "", op: "eq", expected }],
      }),
    });
    caseIds.push(c.id);
  }
  const failedTaskId = await executeCases(request, projectId, def.id, { caseIds, envId });
  const failedFinal = await pollTask(request, projectId, failedTaskId);
  expect(failedFinal.status).toBe("FAILED");

  const okDef = await createApiDef(request, projectId, {
    name: `成功定义-${uniq}`,
    path: "/ok",
    request: bundle("GET", "http://127.0.0.1:4001/hello"),
  });
  const okCase = await createApiCase(request, projectId, okDef.id, {
    name: `成功用例-${uniq}`,
    request: bundle("GET", "http://127.0.0.1:4001/hello"),
  });
  const okTaskId = await executeCases(request, projectId, okDef.id, { caseIds: [okCase.id] });
  expect((await pollTask(request, projectId, okTaskId)).status).toBe("SUCCESS");

  // ── 用户路径：任务中心 → 本项目 Tab 出现行（类型徽标 接口用例）──
  await navFromHome(page, "任务中心");
  await expect(page.getByTestId("scope-tab-project")).toBeVisible();
  const failedRow = page
    .getByTestId("task-list-table")
    .getByRole("row", { name: new RegExp(failedTaskId.slice(0, 8)) });
  await expect(failedRow).toBeVisible();
  await expect(failedRow.getByText("接口用例")).toBeVisible();
  await expect(failedRow.getByText("FAILED", { exact: true })).toBeVisible();
  // 进度列 2/3（2 通过 1 失败）
  await expect(failedRow.getByText("2/3")).toBeVisible();

  // 终态操作两态：FAILED 行有重跑；SUCCESS 行仅查看报告（无重跑）
  await expect(failedRow.getByTestId(/btn-rerun-\d/)).toBeVisible();
  const okRow = page
    .getByTestId("task-list-table")
    .getByRole("row", { name: new RegExp(okTaskId.slice(0, 8)) });
  await expect(okRow.getByText("SUCCESS", { exact: true })).toBeVisible();
  await expect(okRow.getByTestId(/btn-rerun-\d/)).toHaveCount(0);

  // ── 重跑：生成新行「重跑自 ← 旧任务」──
  const rerunApi = expectApi("**/api/v1/projects/*/exec-tasks/*/rerun");
  await failedRow.getByTestId(/btn-rerun-\d/).click();
  const rerun = await rerunApi;
  expect(rerun.status).toBe(201);
  expect(rerun.code).toBe(0);
  const newTaskId = (rerun.data as { taskId: string }).taskId;
  expect(newTaskId).not.toBe(failedTaskId);
  await expect(page.getByText(/已发起重跑，新任务/)).toBeVisible();
  const rerunRow = page
    .getByTestId("task-list-table")
    .getByRole("row", { name: new RegExp(newTaskId.slice(0, 8)) });
  await expect(rerunRow).toBeVisible({ timeout: 15000 });
  await expect(rerunRow).toContainText(failedTaskId.slice(0, 8)); // 重跑自 ← 旧 id

  // ── 全部项目 Tab 可切换（scope-tabs）──
  const allListP = page.waitForResponse((r) => /\/api\/v1\/exec-tasks\?/.test(r.url()));
  await page.getByTestId("scope-tab-all").click();
  const allList = await allListP;
  expect(allList.status()).toBe(200);
  await expect(
    page.getByTestId("task-list-table").getByRole("row", { name: new RegExp(okTaskId.slice(0, 8)) }),
  ).toBeVisible();

  // ── 定时任务 Tab 空态（S3/S4/S6 接入前）──
  // S3 起定时任务数据源接入（API-008 SchedulePanel）：本项目范围显示面板；全部范围显示项目级配置指引空态
  await page.getByTestId("scope-tab-project").click();
  await page.getByTestId("task-tab-cron").click();
  await expect(page.getByTestId("schedule-panel")).toBeVisible();
  await page.getByTestId("scope-tab-all").click();
  await expect(page.getByTestId("cron-empty")).toBeVisible();
  await expect(page.getByTestId("cron-empty")).toContainText("项目级配置");

  await expectNoConsoleErrors();
});

test("SYS-006-02 状态筛选：FAILED → 仅剩失败行（UI 行数 + query 参数）", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  const uniq = `F6${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;

  // 数据准备：一成功一失败两个任务
  const envId = await createEnv(request, projectId, `筛环境-${uniq}`);
  const mk = async (expected: string) => {
    const def = await createApiDef(request, projectId, {
      name: `筛定义${expected}-${uniq}`,
      path: "/hello",
      request: bundle("GET", "${base}/hello", {
        asserts: [{ kind: "status_code", path: "", op: "eq", expected }],
      }),
    });
    const c = await createApiCase(request, projectId, def.id, {
      name: `筛用例${expected}-${uniq}`,
      request: bundle("GET", "${base}/hello", {
        asserts: [{ kind: "status_code", path: "", op: "eq", expected }],
      }),
    });
    return executeCases(request, projectId, def.id, { caseIds: [c.id], envId });
  };
  const failTaskId = await mk("500");
  const okTaskId = await mk("200");
  expect((await pollTask(request, projectId, failTaskId)).status).toBe("FAILED");
  expect((await pollTask(request, projectId, okTaskId)).status).toBe("SUCCESS");

  await navFromHome(page, "任务中心");
  const failRow = page
    .getByTestId("task-list-table")
    .getByRole("row", { name: new RegExp(failTaskId.slice(0, 8)) });
  const okRow = page
    .getByTestId("task-list-table")
    .getByRole("row", { name: new RegExp(okTaskId.slice(0, 8)) });
  await expect(failRow).toBeVisible();
  await expect(okRow).toBeVisible();

  // ── 状态筛选 FAILED：接口断言 query 参数 + UI 行数 ──
  const filteredP = page.waitForResponse((r) => /\/exec-tasks\?status=FAILED/.test(r.url()));
  await page.getByTestId("task-filter-status").click();
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText("失败", { exact: true })
    .click();
  const filtered = await filteredP;
  expect(filtered.status()).toBe(200);
  const filteredBody = (await filtered.json()) as { code: number; data: { total: number } };
  expect(filteredBody.code).toBe(0);
  expect(filteredBody.data.total).toBeGreaterThanOrEqual(1);

  await expect(failRow).toBeVisible();
  await expect(okRow).toHaveCount(0);

  await expectNoConsoleErrors();
});
