import { test, expect, navFromHome } from "./fixtures";
import { bundle, createApiCase, createApiDef, getMockUrl, ok, pickOption, updateApiDef } from "./s2-helpers";

/**
 * Sprint 2 主链路 E2E（sprint-overview 验收主线）—— Release Gate。
 * 链路：环境管理建环境（变量+域名指向 mock）→ 接口定义建 /pets/{id}（query+断言+提取）
 * → 执行调试成功 → 保存 → CASE 页签建 2 用例（其一失败）→ 批量执行 → 任务中心看终态
 * → 报告钻取失败行 → 分享链接免登访问 → MOCK 页签建规则并命中（page.request 断言）
 * → 功能用例关联接口用例。
 * 三类断言：每步 UI + expectNoConsoleErrors + expectApi/waitForResponse payload。
 */
test.setTimeout(180_000);

test("MAINFLOW-s2 Sprint2 主链路（环境→定义→调试→用例→批量执行→报告→分享→Mock→关联）", async ({
  authedPage,
  page,
  browser,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `MF${Date.now() % 1e8}${Math.floor(Math.random() * 1e4)}`;
  const envName = `主链路环境-${uniq}`;
  const defName = `宠物商店查询-${uniq}`;
  const passCase = `正常查询用例-${uniq}`;
  const failCase = `异常查询用例-${uniq}`;
  const funcCase = `宠物下单功能用例-${uniq}`;
  const hitBody = '{"code":0,"data":{"id":9,"kind":"dog"}}';

  await page.goto("/");
  await expect(page.getByTestId("topbar")).toBeVisible();

  // ═══ 1. 环境管理：建环境（变量 base + 域名卡指向 mock）═══
  await navFromHome(page, "环境管理");
  await expect(page.getByTestId("env-list-table")).toBeVisible();
  const envCreateApi = expectApi("**/api/v1/projects/*/environments");
  await page.getByTestId("btn-new-env").click();
  await envCreateApi;
  await page.getByTestId("input-env-name").fill(envName);
  await page.getByTestId("btn-add-var").click();
  const varRow = page.getByTestId("env-vars-row").first();
  await varRow.locator('input[placeholder="key"]').fill("base");
  await varRow.locator('input[placeholder="value"]').fill("http://127.0.0.1:4001");
  await page.getByTestId("env-tab-http").click();
  await page.getByTestId("btn-add-http").click();
  const httpCard = page.getByTestId("env-http-card").first();
  await httpCard.locator('input[placeholder="名称"]').fill("默认");
  await httpCard.locator('input[placeholder="hostname"]').fill("127.0.0.1");
  await httpCard.locator('input[placeholder^="/前缀"]').fill("");
  const envSaveRaw = page.waitForResponse(
    (r) => r.url().includes("/environments/") && !r.url().includes("copy") && r.request().method() === "PUT",
  );
  await page.getByTestId("btn-save-env").click();
  const envSaved = await envSaveRaw;
  expect(envSaved.status()).toBe(200);
  const envPayload = envSaved.request().postDataJSON() as { name: string };
  expect(envPayload.name).toBe(envName);
  await expect(page.getByText("环境已保存")).toBeVisible();
  const envList = await request.get(`/api/v1/projects/${projectId}/environments`);
  const envId = (await ok<{ items: { name: string; id: string }[] }>(envList)).items.find(
    (e) => e.name === envName,
  )!.id;

  // ═══ 2. 接口定义：新建 GET /pets/{id}（query+断言+提取）═══
  await navFromHome(page, "接口定义");
  await page.getByTestId("btn-new-api").click();
  await page.getByTestId("input-new-name").fill(defName);
  await page.getByTestId("input-new-path").fill("/pets/{id}");
  const defCreateApi = expectApi("**/api/v1/projects/*/apis");
  await page.getByRole("button", { name: /创建并编辑/ }).click();
  const defCreated = await defCreateApi;
  expect(defCreated.status).toBe(201);
  const defId = (defCreated.data as { id: string }).id;

  // API 页签完整参数：query kind=dog + 断言 200 + 提取 $.data.kind
  await page.getByTestId("req-tab-params").click();
  await page.getByTestId("req-query-rows").getByText("＋ 添加").click();
  const qRow = page.getByTestId("req-query-row").first();
  await qRow.locator('input[placeholder="key"]').fill("kind");
  await qRow.locator('input[placeholder^="value"]').fill("dog");
  await page.getByTestId("req-tab-asserts").click();
  await page.getByTestId("req-panel-asserts").getByRole("button", { name: "＋ 添加断言" }).click();
  await page.getByTestId("req-tab-post").click();
  await page.getByTestId("req-panel-post").getByRole("button", { name: "＋ 添加提取" }).click();
  const exRow = page.getByTestId("extract-row").first();
  await exRow.locator('input[placeholder^="表达式"]').fill("$.data.kind");
  await exRow.locator('input[placeholder="变量名"]').fill("petKind");

  // URL 用 ${base} + mock 规则数据准备（旁路 API）：环境 base 指向 mock 命名空间；先建 kind=dog 规则
  const mockUrlBase = (
    await ok<{ url: string }>(
      await request.get(`/api/v1/projects/${projectId}/apis/${defId}/mock-url`),
    )
  ).url.replace("/pets/{id}", "");
  const envDetail = await ok<{ config: { vars: { key: string; value: string; enabled: boolean }[]; http: unknown[]; hosts: unknown[]; database: unknown[]; pre: unknown[]; post: unknown[]; asserts: unknown[]; extracts: unknown[] } }>(
    await request.get(`/api/v1/projects/${projectId}/environments/${envId}`),
  );
  const envPut = await request.put(`/api/v1/projects/${projectId}/environments/${envId}`, {
    data: {
      name: envName,
      config: {
        ...envDetail.config,
        vars: [{ key: "base", value: mockUrlBase, enabled: true }],
      },
    },
  });
  expect(envPut.status()).toBe(200);
  const rule1 = await request.post(`/api/v1/projects/${projectId}/apis/${defId}/mocks`, {
    data: {
      name: `狗规则-${uniq}`,
      enabled: true,
      followApi: false,
      matchers: { headers: [], query: [{ key: "kind", value: "dog" }] },
      response: { status: 200, headers: [], body: hitBody, delayMs: 0 },
    },
  });
  expect(rule1.status()).toBe(201);

  // ═══ 3. 保存（v2，payload 含完整参数体系）→ 选环境执行调试成功（UI）═══
  await page.getByTestId("input-api-path").fill("${base}/pets/9");
  const saveRaw = page.waitForResponse((r) => /\/apis\/[^/]+$/.test(r.url()) && r.request().method() === "PUT");
  await page.getByTestId("btn-save-api").click();
  const savedRes = await saveRaw;
  expect(savedRes.status()).toBe(200);
  const savedPayload = savedRes.request().postDataJSON() as {
    request: { spec: { url: string; query: { key: string }[] }; asserts: unknown[]; extracts: unknown[] };
  };
  expect(savedPayload.request.spec.url).toBe("${base}/pets/9");
  expect(savedPayload.request.spec.query.map((q) => q.key)).toContain("kind");
  expect(savedPayload.request.asserts).toHaveLength(1);
  expect(savedPayload.request.extracts).toHaveLength(1);
  await expect(page.getByText(/已保存（v2）/)).toBeVisible();

  await pickOption(page, page.getByTestId("env-select"), envName);
  const debugApi = expectApi("**/api/v1/projects/*/apis/*/debug");
  await page.getByTestId("btn-exec-api").click();
  const debugged = await debugApi;
  expect(debugged.status).toBe(201);
  await expect(page).toHaveURL(/\/reports\//, { timeout: 15000 });
  await expect(page.getByTestId("report-status")).toHaveText("SUCCESS", { timeout: 30000 });
  // 单请求视图展示提交的原始 URL（渲染后实际 URL 在 api_case 钻取视图，见步骤 6）
  await expect(page.getByTestId("report-request")).toContainText("${base}/pets/9");
  await expect(page.getByTestId("assert-pass").first()).toBeVisible();

  // ═══ 4. 返回详情（v2 已保存）═══
  await navFromHome(page, "接口定义");
  await page.getByRole("link", { name: defName }).click();
  await expect(page.getByTestId("input-api-name")).toHaveValue(defName);
  await expect(page.getByText("当前版本 v2")).toBeVisible();

  // ═══ 5. CASE 页签建 2 用例（其一断言 500 失败）→ 批量执行 → 任务中心终态 ═══
  await page.getByTestId("api-tab-case").click();
  const caseTable = page.getByTestId("case-list-table");
  for (const [name, expected] of [
    [passCase, "200"],
    [failCase, "500"],
  ] as const) {
    await page.getByTestId("btn-new-case").click();
    const m = page.getByRole("dialog");
    await m.getByTestId("input-new-case-name").fill(name);
    await m.getByRole("button", { name: /^创\s*建$/ }).click();
    // .first()：CI 慢机上连建两条用例时 antd toast（3s）并存触发 strict violation（2026-09-27 S7 CI 首红定位）
    await expect(page.getByText(/用例已创建/).first()).toBeVisible();
    // 修改失败用例断言：编辑抽屉把状态码期望改 500
    if (expected === "500") {
      const row = caseTable.getByRole("row", { name: new RegExp(name) });
      await row.getByRole("button", { name: /编\s*辑/ }).click();
      const drawer = page.locator(".ant-drawer-content-wrapper");
      await drawer.getByTestId("req-tab-asserts").click();
      await drawer.getByTestId("assert-row").first().locator('input[placeholder="200"]').fill("500");
      await drawer.getByTestId("btn-save-case").click();
      await expect(page.getByText("用例已保存")).toBeVisible();
    }
  }
  await expect(caseTable.getByRole("row", { name: new RegExp(passCase) })).toBeVisible();
  await expect(caseTable.getByRole("row", { name: new RegExp(failCase) })).toBeVisible();

  await caseTable.getByRole("row", { name: new RegExp(passCase) }).locator("input[type=checkbox]").check();
  await caseTable.getByRole("row", { name: new RegExp(failCase) }).locator("input[type=checkbox]").check();
  await page.getByTestId("btn-batch-exec").click();
  const batchModal = page.getByRole("dialog");
  await pickOption(page, batchModal.getByTestId("env-select"), envName);
  const execApi = expectApi("**/api/v1/projects/*/apis/*/cases/execute");
  await batchModal.getByRole("button", { name: /提交执行/ }).click();
  const executed = await execApi;
  expect(executed.status).toBe(201);
  const taskId = (executed.data as { taskId: string }).taskId;

  // 任务中心：终态 FAILED
  await expect(page).toHaveURL(/\/tasks/, { timeout: 10000 });
  const taskRow = page.getByTestId("task-list-table").getByRole("row", { name: new RegExp(taskId.slice(0, 8)) });
  await expect(taskRow).toBeVisible();
  await expect(taskRow.getByText("FAILED", { exact: true })).toBeVisible({ timeout: 30000 });

  // ═══ 6. 报告钻取失败行（断言实际值 200）═══
  await taskRow.getByRole("button", { name: "查看报告" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${taskId}`), { timeout: 10000 });
  await expect(page.getByTestId("report-status")).toHaveText("FAILED", { timeout: 30000 });
  const failRow = page.getByTestId("report-items-table").getByRole("row", { name: new RegExp(failCase) });
  await failRow.click();
  await expect(page.getByTestId("item-drilldown")).toBeVisible();
  const failAssertRow = page.getByTestId("asserts-table").locator("tbody tr").filter({ hasText: "状态码" });
  await expect(failAssertRow).toContainText("500");
  await expect(failAssertRow).toContainText("200"); // 实际值

  // ═══ 7. 分享链接免登访问 ═══
  const shareP = page.waitForResponse((r) => /\/shares$/.test(r.url()) && r.request().method() === "POST");
  await page.getByTestId("btn-share-report").click();
  await page.getByTestId("btn-create-share").click();
  const sharedRes = await shareP;
  expect(sharedRes.status()).toBe(201);
  const token = ((await sharedRes.json()) as { data: { token: string } }).data.token;
  const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
  const anonCtx = await browser.newContext();
  const anonPage = await anonCtx.newPage();
  await anonPage.goto(`${BASE}/share/report/${token}`);
  await expect(anonPage.getByTestId("share-report-view")).toBeVisible({ timeout: 15000 });
  await expect(anonPage.getByTestId("share-banner")).toContainText("只读分享");
  await expect(anonPage.getByTestId("report-items-table").getByRole("row", { name: new RegExp(passCase) })).toBeVisible();
  await anonCtx.close();
  await page.locator(".ant-modal-close").click();

  // ═══ 8. MOCK 页签建规则（无匹配条件，兜底）并命中（page.request 断言；带 kind=dog 仍优先命中条件更多的规则）═══
  // 步骤 3 保存把定义 URL 定为 ${base}/pets/9（path 列随之变化）；Mock 模板需路径形态——
  // 先经 API 把定义 URL 恢复为路径模板 /pets/{id}（snapshot 随之重发布；用例基线已在步骤 5 取走不受影响）
  await updateApiDef(request, projectId, defId, { request: bundle("GET", "/pets/{id}") });
  await navFromHome(page, "接口定义");
  await page.getByRole("link", { name: defName }).click();
  await page.getByTestId("api-tab-mock").click();
  await expect(page.getByTestId("mock-url-box")).toContainText("/pets/{id}");
  await expect(page.getByTestId("mock-rule-table").getByRole("row", { name: new RegExp(`狗规则-${uniq}`) })).toBeVisible();
  await page.getByTestId("btn-new-mock").click();
  const mockModal = page.getByRole("dialog");
  await mockModal.getByTestId("input-mock-name").fill(`兜底规则-${uniq}`);
  await mockModal.getByPlaceholder('{"code": 0}').fill('{"ui":"fallback-rule"}');
  const mockCreateApi = expectApi("**/api/v1/projects/*/apis/*/mocks");
  await mockModal.getByRole("button", { name: /保\s*存/ }).click();
  const mockCreated = await mockCreateApi;
  expect(mockCreated.status).toBe(201);

  const freshMockBase = (await getMockUrl(page.request, projectId, defId)).replace("/pets/{id}", "");
  const hitFallback = await page.request.get(`${freshMockBase}/pets/9`);
  expect(hitFallback.status()).toBe(200);
  expect(await hitFallback.text()).toBe('{"ui":"fallback-rule"}');
  const hitDog = await page.request.get(`${freshMockBase}/pets/9?kind=dog`);
  expect(await hitDog.text()).toBe(hitBody);

  // ═══ 9. 功能用例关联接口用例 ═══
  const funcRes = await request.post(`/api/v1/projects/${projectId}/cases`, { data: { name: funcCase } });
  expect(funcRes.status()).toBe(201);
  const caseListRes = await request.get(`/api/v1/projects/${projectId}/apis/${defId}/cases`);
  const apiCaseId = (await ok<{ items: { name: string; id: string }[] }>(caseListRes)).items.find(
    (c) => c.name === passCase,
  )!.id;

  await navFromHome(page, "测试用例");
  await page.getByRole("link", { name: funcCase }).click();
  await page.getByTestId("case-tab-api-refs").click();
  await expect(page.getByTestId("case-api-refs-empty")).toBeVisible();
  await page.getByTestId("btn-link-api").click();
  const picker = page.getByTestId("api-ref-picker");
  await picker.getByTestId("api-ref-picker-search").fill(uniq); // 定义名与用例名同含 uniq
  await picker.getByRole("row", { name: new RegExp(`/pets/\\{id\\}`) }).first().click();
  const option = picker.getByTestId("api-case-option").filter({ hasText: passCase });
  await expect(option).toBeVisible();
  await option.locator('input[type="checkbox"]').check();
  const refApi = expectApi("**/api/v1/projects/*/cases/*/api-refs");
  await page.getByTestId("btn-confirm-link-api").click();
  const refLinked = await refApi;
  expect(refLinked.status).toBe(201); // 用例关联接口为创建语义（201）
  expect((refLinked.data as { added: number }).added).toBe(1);
  await expect(page.getByTestId("case-api-ref-row")).toHaveCount(1);
  await expect(page.getByTestId("case-api-ref-row")).toContainText(passCase);
  void apiCaseId;

  await expectNoConsoleErrors();
});
