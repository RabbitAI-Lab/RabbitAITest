import { test, expect, navFromHome } from "./fixtures";
import {
  bundle,
  createApiCase,
  createApiDef,
  createEnv,
  createMockRule,
  executeCases,
  getMockUrl,
  pickOption,
  pollTask,
  updateApiDef,
} from "./s2-helpers";

/**
 * API-003 接口用例（规格：docs/sprint-2-api-core/API-003-api-case.md）。
 * 三类断言：UI（CASE 页签表格/同步态/diff/历史抽屉）+ Console（expectNoConsoleErrors）
 * + 接口（execute payload、sync syncedVersion、history 记录）。
 */

test("API-003-01 批量执行主链路：勾选→批量执行→任务中心终态→报告 items 两态→失败行钻取", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `C3${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const defName = `批量执行定义-${uniq}`;
  const passName = `正常用例-${uniq}`;
  const failName = `失败用例-${uniq}`;

  // 数据准备（API）：环境 + 定义 ${base}/hello + 2 用例（其一断言 eq 500 故意失败）
  const envId = await createEnv(request, projectId, `批量环境-${uniq}`);
  const def = await createApiDef(request, projectId, {
    name: defName,
    path: "/hello",
    request: bundle("GET", "${base}/hello"),
  });
  const pass = await createApiCase(request, projectId, def.id, {
    name: passName,
    request: bundle("GET", "${base}/hello"),
  });
  const fail = await createApiCase(request, projectId, def.id, {
    name: failName,
    request: bundle("GET", "${base}/hello", {
      asserts: [{ kind: "status_code", path: "", op: "eq", expected: "500" }],
    }),
  });

  // ── 用户路径：接口定义 → 进详情 → CASE 页签 ──
  await navFromHome(page, "接口定义");
  await page.getByRole("link", { name: defName }).click();
  await expect(page.getByTestId("input-api-name")).toHaveValue(defName);
  await page.getByTestId("api-tab-case").click();
  const caseTable = page.getByTestId("case-list-table");
  await expect(caseTable.getByRole("row", { name: new RegExp(passName) })).toBeVisible();
  await expect(caseTable.getByRole("row", { name: new RegExp(failName) })).toBeVisible();

  // 勾选 2 条 → 批量执行（失败停止 on）
  await caseTable.getByRole("row", { name: new RegExp(passName) }).locator("input[type=checkbox]").check();
  await caseTable.getByRole("row", { name: new RegExp(failName) }).locator("input[type=checkbox]").check();
  await page.getByTestId("btn-batch-exec").click();
  const batchModal = page.getByRole("dialog");
  await expect(batchModal).toBeVisible();
  await pickOption(page, batchModal.getByTestId("env-select"), `批量环境-${uniq}`);
  await batchModal.getByTestId("switch-stop-on-fail").click();

  const execApi = expectApi("**/api/v1/projects/*/apis/*/cases/execute");
  const execRaw = page.waitForResponse("**/api/v1/projects/*/apis/*/cases/execute");
  await batchModal.getByRole("button", { name: /提交执行/ }).click();
  const executed = await execApi;
  expect(executed.status).toBe(201);
  expect(executed.code).toBe(0);
  const execRawRes = await execRaw;
  const execPayload = execRawRes.request().postDataJSON() as {
    caseIds: string[];
    envId: string;
    stopOnFail: boolean;
  };
  expect(execPayload.caseIds.sort()).toEqual([pass.id, fail.id].sort());
  expect(execPayload.envId).toBe(envId);
  expect(execPayload.stopOnFail).toBe(true);

  // ── 任务中心：本项目 Tab 出现行（类型徽标）→ 终态 FAILED ──
  await expect(page).toHaveURL(/\/tasks/, { timeout: 10000 });
  await expect(page.getByTestId("scope-tab-project")).toBeVisible();
  const taskId = (executed.data as { taskId: string }).taskId;
  const taskRow = page
    .getByTestId("task-list-table")
    .getByRole("row", { name: new RegExp(taskId.slice(0, 8)) });
  await expect(taskRow).toBeVisible();
  await expect(taskRow.getByText("接口用例")).toBeVisible();
  await expect(taskRow.getByText("FAILED", { exact: true })).toBeVisible({ timeout: 30000 });

  // ── 报告：items 两行（SUCCESS/FAILED 两态）→ 失败行钻取断言表实际值 ──
  await taskRow.getByRole("button", { name: "查看报告" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${taskId}`), { timeout: 10000 });
  await expect(page.getByTestId("report-status")).toHaveText("FAILED", { timeout: 30000 });
  await expect(page.getByTestId("report-summary-cards")).toContainText("1");
  const itemsTable = page.getByTestId("report-items-table");
  await expect(itemsTable.getByRole("row", { name: new RegExp(passName) }).getByText("SUCCESS")).toBeVisible();
  const failRow = itemsTable.getByRole("row", { name: new RegExp(failName) });
  await expect(failRow.getByText("FAILED")).toBeVisible();
  await expect(failRow.getByTestId("assert-fail")).toHaveCount(0); // items 表无断言徽标（在钻取内）

  await failRow.click();
  await expect(page.getByTestId("item-drilldown")).toBeVisible();
  await expect(page.getByTestId("drill-request")).toContainText("/hello");
  const failAssertRow = page.getByTestId("asserts-table").locator("tbody tr").filter({ hasText: "状态码" });
  await expect(failAssertRow).toHaveCount(1);
  await expect(failAssertRow).toContainText("500"); // 期望
  await expect(failAssertRow).toContainText("200"); // 实际值（/hello 返回 200）
  await expect(failAssertRow.getByText("✗ 失败")).toBeVisible();
  await expect(page.getByTestId("extracts-table")).toBeVisible();
  await expect(page.getByTestId("drill-logs")).toBeVisible();

  await expectNoConsoleErrors();
});

test("API-003-02 差异同步二态：定义更新→待同步标记→diff 分区→一键同步→标记消失", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `D3${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const defName = `同步定义-${uniq}`;
  const caseName = `待同步用例-${uniq}`;

  // 数据准备：定义 + 用例（基线=定义 v1）→ PUT 定义请求体 → 用例 outOfSync
  const def = await createApiDef(request, projectId, {
    name: defName,
    path: `/sync-${uniq}`,
    request: bundle("GET", "/sync"),
  });
  const cs = await createApiCase(request, projectId, def.id, {
    name: caseName,
    request: bundle("GET", "/sync"),
  });
  const updated = await updateApiDef(request, projectId, def.id, {
    request: bundle("GET", "/sync", {
      spec: {
        method: "GET",
        url: "/sync",
        headers: [],
        query: [],
        body: { kind: "raw_json", content: '{"changed": true}' },
        auth: { kind: "none" },
        timeoutMs: 10000,
        followRedirects: false,
        skipPre: false,
        skipPost: false,
      },
    }),
  });

  // ── 用户路径：接口定义 → 详情 CASE 页签 → 待同步标记 ──
  await navFromHome(page, "接口定义");
  await page.getByRole("link", { name: defName }).click();
  await page.getByTestId("api-tab-case").click();
  const row = page.getByTestId("case-list-table").getByRole("row", { name: new RegExp(caseName) });
  await expect(row).toBeVisible();
  await expect(row.getByTestId(/case-out-of-sync-\d/).first()).toBeVisible();

  // ── 编辑抽屉：diff 视图可见差异分区（请求体）→ 一键同步 ──
  await row.getByTestId(`btn-edit-case-${cs.num}`).click();
  const drawer = page.locator(".ant-drawer-content-wrapper");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText(/定义已更新/)).toBeVisible();
  await drawer.getByTestId("btn-view-diff").click();
  await expect(drawer.getByTestId("case-diff-panel")).toBeVisible();
  await expect(drawer.getByTestId("case-diff-panel")).toContainText("请求体");
  await expect(drawer.getByTestId("case-diff-panel")).toContainText("changed"); // JSON 序列化展示（含转义引号）

  const syncApi = expectApi("**/api/v1/projects/*/apis/*/cases/*/sync");
  await drawer.getByTestId("btn-sync-overwrite").click();
  await page.getByRole("button", { name: /确定覆盖/ }).click();
  const synced = await syncApi;
  expect(synced.status).toBe(200);
  expect(synced.code).toBe(0);
  expect((synced.data as { syncedVersion: number }).syncedVersion).toBe(updated.version);
  await expect(page.getByText(/已同步至定义 v2/)).toBeVisible();

  // 标记消失（列表失效重查）
  await expect(row.getByTestId(/case-out-of-sync-\d/)).toHaveCount(0);

  await expectNoConsoleErrors();
});

test("API-003-03 执行历史：执行后历史抽屉出现记录→跳报告", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `H3${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const defName = `历史定义-${uniq}`;
  const caseName = `历史用例-${uniq}`;

  const envId = await createEnv(request, projectId, `历史环境-${uniq}`);
  const def = await createApiDef(request, projectId, {
    name: defName,
    path: "/hello",
    request: bundle("GET", "${base}/hello"),
  });
  const cs = await createApiCase(request, projectId, def.id, {
    name: caseName,
    request: bundle("GET", "${base}/hello"),
  });
  const taskId = await executeCases(request, projectId, def.id, { caseIds: [cs.id], envId });
  const final = await pollTask(request, projectId, taskId);
  expect(final.status).toBe("SUCCESS");

  // ── 用户路径：CASE 页签 → 历史 → 记录出现（SUCCESS）→ 查看报告跳转 ──
  await navFromHome(page, "接口定义");
  await page.getByRole("link", { name: defName }).click();
  await page.getByTestId("api-tab-case").click();
  const row = page.getByTestId("case-list-table").getByRole("row", { name: new RegExp(caseName) });
  await expect(row).toBeVisible();

  const historyApi = expectApi("**/api/v1/projects/*/apis/*/cases/*/history");
  await row.getByTestId(`btn-case-history-${cs.num}`).click();
  const history = await historyApi;
  expect(history.status).toBe(200);
  expect(history.code).toBe(0);
  expect((history.data as { items: unknown[] }).items).toHaveLength(1);

  const drawer = page.locator(".ant-drawer-content-wrapper");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("SUCCESS", { exact: true }).first()).toBeVisible();
  await drawer.getByRole("link", { name: "查看报告" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${taskId}`), { timeout: 10000 });
  await expect(page.getByTestId("report-status")).toHaveText("SUCCESS");

  await expectNoConsoleErrors();
});

/** 门禁 8 回补（API-003 §5 T4 后半）：clientTaskId 幂等——同键连点/重试仅生成一个任务
 *  （防抖在 exec.service：PENDING/RUNNING 同键复用）。慢规则（delayMs 6s）保证第二次提交时
 *  首任务必然仍在执行，判定确定性；换键则生成新任务（证明按键去重而非全局拦截）。 */
test("API-003-04 clientTaskId 幂等：同键连点仅生成一任务、换键生成新任务", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  const uniq = `I3${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;

  // 数据准备：慢 mock 规则（6s 延迟，任务保持 RUNNING 供幂等窗口判定）
  const def = await createApiDef(request, projectId, { name: `幂等定义-${uniq}`, path: "/pets/{id}" });
  await createMockRule(request, projectId, def.id, {
    name: `幂等慢规则-${uniq}`,
    respBody: "{}",
    delayMs: 6000,
  });
  const mockUrl = await getMockUrl(request, projectId, def.id);
  const body = {
    type: "api_debug" as const,
    request: bundle("GET", mockUrl.replace("/pets/{id}", "/pets/9")).spec,
    asserts: [],
    pre: [],
    post: [],
    extracts: [],
  };

  // 同键两次提交（连点模拟）→ 复用同一任务
  const key = `e2e-idem-${uniq}`;
  const first = await request.post(`/api/v1/projects/${projectId}/exec-tasks`, {
    data: { ...body, clientTaskId: key },
  });
  expect(first.status()).toBe(201);
  const firstId = ((await first.json()) as { data: { taskId: string } }).data.taskId;
  const second = await request.post(`/api/v1/projects/${projectId}/exec-tasks`, {
    data: { ...body, clientTaskId: key },
  });
  expect(second.status()).toBe(201);
  const secondId = ((await second.json()) as { data: { taskId: string } }).data.taskId;
  expect(secondId).toBe(firstId);

  // 换键 → 新任务（按键去重，非全局拦截）
  const third = await request.post(`/api/v1/projects/${projectId}/exec-tasks`, {
    data: { ...body, clientTaskId: `e2e-idem-2-${uniq}` },
  });
  expect(third.status()).toBe(201);
  const thirdId = ((await third.json()) as { data: { taskId: string } }).data.taskId;
  expect(thirdId).not.toBe(firstId);

  // UI 断言：任务中心同一任务仅一行（首任务 id 前缀唯一定位）
  await navFromHome(page, "任务中心");
  await expect(
    page.getByTestId("task-list-table").getByRole("row", { name: new RegExp(firstId.slice(0, 8)) }),
  ).toHaveCount(1, { timeout: 15000 });

  await expectNoConsoleErrors();
});
