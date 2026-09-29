import { test, expect, navFromHome } from "./fixtures";

/**
 * PLAN-005 计划报告导出（规格 §5 T2/T3）：视图/一键总结/分享/CSV。
 * 三类断言：UI（报告 Tab 六卡+横幅）；Console；接口（draft/summary/shares/export）。
 */

test("PLAN-005-01 报告视图/总结/分享/CSV", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `${Date.now() % 1e7}`;
  const caseName = `报告用例-${uniq}`;
  const caseRes = await request.post(`/api/v1/projects/${projectId}/cases`, {
    data: { name: caseName, precondition: "", steps: [] },
  });
  const caseId = ((await caseRes.json()) as { data: { id: string } }).data.id;
  const planRes = await request.post(`/api/v1/projects/${projectId}/plans`, {
    data: {
      name: `报告计划-${uniq}`,
      settings: { allowDuplicate: false, autoUpdateStatus: false, threshold: 80 },
    },
  });
  const planId = ((await planRes.json()) as { data: { id: string } }).data.id;
  await request.post(`/api/v1/projects/${projectId}/plans/${planId}/cases`, {
    data: { caseIds: [caseId] },
  });
  // 标记 PASS（阈值横幅需已执行口径）
  const det = await request.get(`/api/v1/projects/${projectId}/plans/${planId}`);
  const refId = ((await det.json()) as { data: { cases: { refId: string }[] } }).data.cases[0]!
    .refId;
  await request.post(`/api/v1/projects/${projectId}/plans/${planId}/cases/${refId}/exec`, {
    data: { status: "PASS", actualResult: "通过", comment: "" },
  });

  await navFromHome(page, "测试计划");
  await page.getByRole("link", { name: `报告计划-${uniq}` }).click();
  await page.getByTestId("plan-report-tab").click();

  // 视图：点分组（未分组）与概览卡
  await expect(page.getByTestId("plan-report-v2")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("report-threshold-banner")).toBeVisible();

  // 一键总结（draft 接口断言）
  const draftApi = expectApi("**/api/v1/projects/*/plans/*/report/draft");
  await page.getByTestId("btn-report-draft").click();
  const draft = await draftApi;
  expect(draft.status).toBe(200);
  expect(String((draft.data as { draft: string }).draft)).toContain("执行总结");

  // 保存总结（UI 编辑态）
  await page
    .getByRole("button", { name: "确 定" })
    .click()
    .catch(() => {});
  await page.getByRole("button", { name: /保 存|保存/ }).click();
  await expect(page.getByTestId("summary-text")).toContainText("执行总结", { timeout: 10_000 });

  // 分享：建 token → 免登录页打开（expectApi 置于弹窗 GET 之后，避免误匹配列表请求）
  await page.getByTestId("btn-report-share").click();
  await expect(page.getByTestId("btn-create-share")).toBeVisible({ timeout: 10_000 });
  const shareRaw = page.waitForResponse(
    (r) => r.url().includes("/report/shares") && r.request().method() === "POST",
  );
  await page.getByTestId("btn-create-share").click();
  const shareRes = await shareRaw;
  expect(shareRes.status()).toBe(201);
  const token = ((await shareRes.json()) as { data: { token: string } }).data.token;
  await page.goto(`/share/plan/${token}`);
  await expect(page.getByTestId("share-plan-page")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("share-plan-page")).toContainText(`报告计划-${uniq}`);

  // 打印页
  await page.goto(`/share/plan/${token}/print`);
  await expect(page.getByTestId("share-plan-print-page")).toBeVisible();

  // CSV 导出（接口断言：text/csv + BOM）
  const csvRes = await request.get(`/api/v1/projects/${projectId}/plans/${planId}/report/export`);
  expect(csvRes.status()).toBe(200);
  expect(csvRes.headers()["content-type"]).toContain("text/csv");
  const csvText = await csvRes.text();
  expect(csvText.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM
  expect(csvText).toContain("测试点,用例类型,名称,执行人,状态,实际结果,最近执行,执行报告");

  await expectNoConsoleErrors();
});
