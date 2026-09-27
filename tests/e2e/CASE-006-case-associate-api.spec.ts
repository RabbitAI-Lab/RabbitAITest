import { test, expect, navFromHome } from "./fixtures";
import { bundle, createApiCase, createApiDef } from "./s2-helpers";

/**
 * CASE-006 用例关联接口（规格：docs/sprint-2-api-core/CASE-006-case-associate-api.md）。
 * 覆盖：用例侧「关联」Tab 空态→选择器（树+展开定义勾选 CASE）→关联 2→移除 1；
 * 计划侧关联弹窗「接口用例」Tab→勾选 2→计划清单「接口」徽标行 NOT_RUN + 执行(S4) 禁用，
 * 功能+接口混合清单共存。
 * 三类断言：UI + Console + 接口（api-refs POST payload refIds、plans cases apiCaseIds）。
 */

test("CASE-006-01 用例侧：关联 Tab 空态→选择器勾选 2 条→列表 2 行→移除 1 行", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `K6${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const defName = `关联定义-${uniq}`;
  const caseName = `功能用例-${uniq}`;
  const apiCaseA = `关联接口用例A-${uniq}`;
  const apiCaseB = `关联接口用例B-${uniq}`;

  // 数据准备：定义 + 2 条接口用例 + 1 条功能用例
  const def = await createApiDef(request, projectId, { name: defName, path: `/assoc-${uniq}` });
  const cA = await createApiCase(request, projectId, def.id, { name: apiCaseA, request: bundle("GET", `/assoc-${uniq}`) });
  const cB = await createApiCase(request, projectId, def.id, { name: apiCaseB, request: bundle("GET", `/assoc-${uniq}`) });
  const caseRes = await request.post(`/api/v1/projects/${projectId}/cases`, { data: { name: caseName } });
  expect(caseRes.status()).toBe(201);

  // ── 用户路径：测试用例 → 详情「关联」Tab（空态）──
  await navFromHome(page, "测试用例");
  await page.getByRole("link", { name: caseName }).click();
  await expect(page.getByTestId("case-title")).toHaveText(caseName);
  await page.getByTestId("case-tab-api-refs").click();
  const panel = page.getByTestId("case-api-refs-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("case-api-refs-empty")).toBeVisible();

  // ── 选择器：展开定义行勾选 2 条 CASE ──
  await page.getByTestId("btn-link-api").click();
  const picker = page.getByTestId("api-ref-picker");
  await expect(picker).toBeVisible();
  await picker.getByTestId("api-ref-picker-search").fill(uniq); // 定义名与用例名同含 uniq（展开行按同关键字过滤 CASE）
  const defRow = picker.getByRole("row", { name: new RegExp(`/assoc-${uniq}`) });
  await expect(defRow).toBeVisible();
  await defRow.click(); // expandRowByClick 展开 CASE 勾选
  const optionA = picker.getByTestId("api-case-option").filter({ hasText: apiCaseA });
  const optionB = picker.getByTestId("api-case-option").filter({ hasText: apiCaseB });
  await expect(optionA).toBeVisible();
  await expect(optionB).toBeVisible();
  await optionA.locator('input[type="checkbox"]').check();
  await optionB.locator('input[type="checkbox"]').check();
  await expect(picker.getByText("已选 2 条")).toBeVisible();

  const linkApi = expectApi("**/api/v1/projects/*/cases/*/api-refs");
  const linkRaw = page.waitForResponse("**/api/v1/projects/*/cases/*/api-refs");
  await page.getByTestId("btn-confirm-link-api").click();
  const linked = await linkApi;
  expect(linked.status).toBe(201); // 用例关联接口为创建语义（201）
  expect(linked.code).toBe(0);
  expect((linked.data as { added: number }).added).toBe(2);
  const linkRawRes = await linkRaw;
  const refPayload = linkRawRes.request().postDataJSON() as { refIds: string[] };
  expect(refPayload.refIds.sort()).toEqual([cA.id, cB.id].sort());
  await expect(page.getByText("已关联 2 条接口用例")).toBeVisible();

  // ── 列表 2 行 → 移除 1 行 ──
  const refRows = panel.getByTestId("case-api-ref-row");
  await expect(refRows).toHaveCount(2);
  await expect(refRows.filter({ hasText: apiCaseA })).toBeVisible();
  const removeApi = expectApi("**/api/v1/projects/*/cases/*/api-refs*");
  await refRows.filter({ hasText: apiCaseA }).getByRole("button", { name: /移\s*除/ }).click();
  await page.locator(".ant-popover").getByRole("button", { name: /确\s*定/ }).click();
  const removed = await removeApi;
  expect(removed.status).toBe(200);
  expect(removed.code).toBe(0);
  await expect(page.getByText("已移除关联")).toBeVisible();
  await expect(refRows).toHaveCount(1);
  await expect(refRows.filter({ hasText: apiCaseB })).toBeVisible();

  await expectNoConsoleErrors();
});

test("CASE-006-02 计划侧：关联弹窗「接口用例」Tab→勾选 2→清单「接口」徽标 + 执行(S4) 禁用 + 混合共存", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `L6${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const planName = `混合计划-${uniq}`;
  const funcName = `混合功能用例-${uniq}`;
  const defName = `混合定义-${uniq}`;
  const apiCaseA = `混合接口用例A-${uniq}`;
  const apiCaseB = `混合接口用例B-${uniq}`;

  // 数据准备：功能用例 + 计划 +（API 已关联功能用例），定义 + 2 接口用例
  const caseRes = await request.post(`/api/v1/projects/${projectId}/cases`, { data: { name: funcName } });
  const caseId = ((await caseRes.json()) as { data: { id: string } }).data.id;
  const planRes = await request.post(`/api/v1/projects/${projectId}/plans`, { data: { name: planName } });
  expect(planRes.status()).toBe(201);
  const planId = ((await planRes.json()) as { data: { id: string } }).data.id;
  const linkFunc = await request.post(`/api/v1/projects/${projectId}/plans/${planId}/cases`, {
    data: { caseIds: [caseId], apiCaseIds: [] },
  });
  expect(linkFunc.status()).toBe(200);

  const def = await createApiDef(request, projectId, { name: defName, path: `/mix-${uniq}` });
  const cA = await createApiCase(request, projectId, def.id, { name: apiCaseA, request: bundle("GET", `/mix-${uniq}`) });
  const cB = await createApiCase(request, projectId, def.id, { name: apiCaseB, request: bundle("GET", `/mix-${uniq}`) });

  // ── 用户路径：测试计划 → 详情 → 关联用例弹窗切「接口用例」Tab ──
  await navFromHome(page, "测试计划");
  await page.getByRole("link", { name: planName }).click();
  await expect(page.getByTestId("plan-cases-tab")).toBeVisible();
  await expect(page.getByTestId("plan-cases-tab")).toContainText("用例清单（1）");
  await page.getByTestId("btn-link-cases").click();
  const modal = page.getByTestId("link-cases-modal");
  await expect(modal).toBeVisible();
  // Tab 条在 Modal 内、link-cases-modal 容器外（后者仅是「功能用例」Tab 的内容区）
  await page.getByRole("dialog").getByTestId("link-tab-api-cases").click();

  const apiModal = page.getByTestId("link-api-cases-modal");
  await expect(apiModal).toBeVisible();
  await apiModal.getByTestId("link-api-keyword").fill(uniq); // 同上：定义与 CASE 名同含 uniq
  const defRow = apiModal.getByRole("row", { name: new RegExp(`/mix-${uniq}`) });
  await expect(defRow).toBeVisible();
  await defRow.click();
  const optionA = apiModal.getByTestId("plan-api-case-option").filter({ hasText: apiCaseA });
  const optionB = apiModal.getByTestId("plan-api-case-option").filter({ hasText: apiCaseB });
  await expect(optionA).toBeVisible();
  await expect(optionB).toBeVisible();
  await optionA.locator('input[type="checkbox"]').check();
  await optionB.locator('input[type="checkbox"]').check();
  await expect(apiModal.getByText("已选 2 项")).toBeVisible();

  // 接口断言：payload apiCaseIds 2 条（caseIds 空）
  const linkApi = expectApi("**/api/v1/projects/*/plans/*/cases");
  const linkRaw = page.waitForResponse("**/api/v1/projects/*/plans/*/cases");
  await apiModal.getByTestId("btn-confirm-link-api-cases").click();
  const linked = await linkApi;
  expect(linked.status).toBe(200);
  expect(linked.code).toBe(0);
  const linkRawRes = await linkRaw;
  const linkPayload = linkRawRes.request().postDataJSON() as { caseIds: string[]; apiCaseIds: string[] };
  expect(linkPayload.caseIds).toEqual([]);
  expect(linkPayload.apiCaseIds.sort()).toEqual([cA.id, cB.id].sort());
  await expect(page.getByText(/已关联 2 条用例（功能 0 提交 · 接口 2 提交）/)).toBeVisible();

  // ── 计划清单：「接口」徽标行 ×2，未执行徽标 + 行内单条执行按钮（S4 PLAN-003 激活）；功能行共存 ──
  await expect(page.getByTestId("plan-cases-tab")).toContainText("用例清单（3）");
  await expect(page.getByTestId("plan-api-ref-badge")).toHaveCount(2);
  const apiRowA = page.getByRole("row", { name: new RegExp(apiCaseA) });
  await expect(apiRowA.getByText("● 未执行")).toBeVisible();
  await expect(apiRowA.getByRole("button", { name: "▶" })).toBeEnabled();
  // 混合共存：功能用例行仍是链接 + 可展开
  const funcRow = page.getByRole("row", { name: new RegExp(funcName) });
  await expect(funcRow.getByRole("link", { name: funcName })).toBeVisible();
  await expect(funcRow.getByTestId(/plan-api-ref-badge/)).toHaveCount(0);

  await expectNoConsoleErrors();
});

/** 门禁 8 回补（CASE-006 §5 T4）：重复关联被拒（422 code 10009）+ 关联目标软删后行灰显「已删除」。
 *  服务端 addCaseApiRefs：全量重复 → DUP_ASSOC；Provider listCaseApiRefs 标记 deleted 行。 */
test("CASE-006-03 重复关联 422(10009) + 已删除接口用例灰显「已删除」", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  const uniq = `M6${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const defName = `重复关联定义-${uniq}`;
  const caseName = `重复关联功能用例-${uniq}`;
  const apiCaseName = `重复关联接口用例-${uniq}`;

  // 数据准备：定义 + 1 接口用例 + 1 功能用例，先经 API 建立关联
  const def = await createApiDef(request, projectId, { name: defName, path: `/dup-${uniq}` });
  const c = await createApiCase(request, projectId, def.id, {
    name: apiCaseName,
    request: bundle("GET", `/dup-${uniq}`),
  });
  const caseRes = await request.post(`/api/v1/projects/${projectId}/cases`, { data: { name: caseName } });
  const caseId = ((await caseRes.json()) as { data: { id: string } }).data.id;
  const link = await request.post(`/api/v1/projects/${projectId}/cases/${caseId}/api-refs`, {
    data: { refIds: [c.id] },
  });
  expect(link.status()).toBe(201);

  // 接口断言：重复关联 → 422 code 10009（DUP_ASSOC）
  const dup = await request.post(`/api/v1/projects/${projectId}/cases/${caseId}/api-refs`, {
    data: { refIds: [c.id] },
  });
  expect(dup.status()).toBe(422);
  expect(((await dup.json()) as { code: number }).code).toBe(10009);

  // UI 断言：关联 Tab 1 行（正常态）
  await navFromHome(page, "测试用例");
  await page.getByRole("link", { name: caseName }).click();
  await page.getByTestId("case-tab-api-refs").click();
  const refRows = page.getByTestId("case-api-refs-panel").getByTestId("case-api-ref-row");
  await expect(refRows).toHaveCount(1);
  await expect(refRows.filter({ hasText: apiCaseName }).getByText("已删除")).toHaveCount(0);

  // 接口断言：软删接口用例 → 整页重载（Tab 处于激活态时重点击不触发重取）后行灰显「已删除」徽标
  const del = await request.delete(`/api/v1/projects/${projectId}/apis/${def.id}/cases/${c.id}`);
  expect(del.status()).toBe(200);
  await page.reload();
  await page.getByTestId("case-tab-api-refs").click();
  const deletedRow = refRows.filter({ hasText: apiCaseName });
  await expect(deletedRow).toHaveCount(1);
  await expect(deletedRow.getByText("已删除")).toBeVisible();

  await expectNoConsoleErrors();
});
