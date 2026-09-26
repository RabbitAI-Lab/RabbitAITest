import { test, expect, navFromHome } from "./fixtures";

/**
 * PLAN-001 测试计划基础（规格：docs/sprint-1-mvp-test-mgmt/PLAN-001-test-plan-basic.md §5 T2/T3）
 * 三类断言（rules/testing.md §3.1）：
 * - UI：plan-circle 通过率环 / plan-pass-rate-box 阈值徽标 / step-exec-panel 步骤面板 / archived-banner 归档横幅 / bug 详情关联用例 Tab
 * - Console：expectNoConsoleErrors
 * - 接口：expectApi（plans 创建/关联/exec/archive 的 status + code + data；payload 用 waitForResponse 补充——fixtures.expectApi 未暴露 postData）
 * 业务码（packages/shared/src/envelope.ts）：10009 DUP_ASSOC（重复关联）、10008 PLAN_ARCHIVED（归档后写操作）。
 */

test("PLAN-001-01 计划执行与缺陷带出", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const planName = `支付回归计划-${uniq}`;
  const caseName = `支付流程用例-${uniq}`;
  const stepFailActual = "支付接口超时未返回";

  // API 造 1 条含 2 步骤的用例（数据独立）
  const caseRes = await request.post(`/api/v1/projects/${projectId}/cases`, {
    data: {
      name: caseName,
      precondition: "已登录且购物车有商品",
      steps: [
        { desc: "提交订单", expect: "订单创建成功" },
        { desc: "完成支付", expect: "支付成功且回到订单页" },
      ],
    },
  });
  expect(caseRes.status()).toBe(201);
  const caseBody = (await caseRes.json()) as { code: number; data: { id: string } };
  expect(caseBody.code).toBe(0);
  const caseId = caseBody.data.id;

  // 用户路径：首页 → 左侧导航「测试计划」（LeftNav.tsx:35）→ 新建计划（阈值 80）
  await navFromHome(page, "测试计划");
  await page.getByTestId("btn-new-plan").click();
  await page.getByTestId("input-plan-name").fill(planName);
  await page.getByTestId("input-threshold").fill("80");
  const planApiP = expectApi("**/api/v1/projects/*/plans");
  const planRaw = page.waitForResponse("**/api/v1/projects/*/plans");
  await page.getByTestId("btn-submit-plan").click();
  const planCreated = await planApiP;
  expect(planCreated.status).toBe(201);
  expect(planCreated.code).toBe(0);
  const planRawRes = await planRaw;
  expect(planRawRes.request().method()).toBe("POST");
  expect(
    (planRawRes.request().postDataJSON() as { settings: { threshold: number } }).settings.threshold,
  ).toBe(80);

  // 进详情（列表行名称链接，用户路径内跳转）
  await page.getByRole("link", { name: planName }).click();
  await expect(page.getByTestId("plan-cases-tab")).toBeVisible();

  // 关联用例（btn-link-cases → 弹窗检索勾选；payload 断言 caseIds 正确）
  await page.getByTestId("btn-link-cases").click();
  const linkModal = page.getByTestId("link-cases-modal");
  await expect(linkModal).toBeVisible();
  await page.getByTestId("link-cases-keyword").fill(caseName);
  await linkModal
    .getByRole("row", { name: new RegExp(caseName) })
    .locator('input[type="checkbox"]')
    .check();
  const linkApi = expectApi("**/api/v1/projects/*/plans/*/cases");
  const linkRaw = page.waitForResponse("**/api/v1/projects/*/plans/*/cases");
  await page.getByTestId("btn-confirm-link-cases").click();
  const linked = await linkApi;
  expect(linked.status).toBe(200);
  expect(linked.code).toBe(0);
  expect((linked.data as { added: number }).added).toBe(1);
  const linkRawRes = await linkRaw;
  expect((linkRawRes.request().postDataJSON() as { caseIds: string[] }).caseIds).toEqual([caseId]);
  await expect(page.getByTestId("plan-cases-tab")).toContainText("用例清单（1）");

  // 行展开步骤执行面板：第一步 PASS 第二步 FAIL 填实际结果保存（接口断言 exec code=0 + payload）
  const row = page.getByRole("row", { name: new RegExp(caseName) });
  await row.getByRole("button", { name: "步骤执行" }).click();
  await expect(page.getByTestId("step-exec-panel")).toBeVisible();
  await page.getByTestId("step-btn-PASS-1").click();
  await page.getByTestId("step-btn-FAIL-2").click();
  await page.getByTestId("step-actual-2").fill(stepFailActual);
  const execApi = expectApi("**/api/v1/projects/*/plans/*/cases/*/exec");
  const execRaw = page.waitForResponse("**/api/v1/projects/*/plans/*/cases/*/exec");
  await page.getByTestId("step-exec-panel").getByRole("button", { name: "保存执行结果" }).click();
  const execRes = await execApi;
  expect(execRes.status).toBe(200);
  expect(execRes.code).toBe(0);
  expect((execRes.data as { status: string }).status).toBe("FAIL");
  const execRawRes = await execRaw;
  const execPayload = execRawRes.request().postDataJSON() as {
    status: string;
    steps: { status: string; result: string }[];
  };
  expect(execPayload.status).toBe("FAIL");
  expect(execPayload.steps[0].status).toBe("PASS");
  expect(execPayload.steps[1]).toMatchObject({ status: "FAIL", result: stepFailActual });

  // 通过率环 = 0%（规格 PLAN-001 §3：pass/(pass+fail+blocked) 用例级口径，本计划 1 条用例 FAIL）
  // + 未达标徽标（阈值 80，plan-pass-rate-box）
  await expect(page.getByTestId("plan-circle")).toContainText("0%");
  await expect(page.getByTestId("plan-pass-rate-box")).toContainText("阈值 80%");
  await expect(page.getByTestId("plan-pass-rate-box")).toContainText("未达标");

  // 失败行新建缺陷：标题预填用例名、描述含失败步骤（BugModal 预填，plans/[id]/page.tsx）
  await row.getByRole("button", { name: "缺陷" }).click();
  await expect(page.getByTestId("new-bug-form")).toBeVisible();
  await expect(page.getByTestId("input-bug-title")).toHaveValue(caseName);
  const prefDesc = await page.getByTestId("input-bug-desc").inputValue();
  expect(prefDesc).toContain("失败步骤");
  expect(prefDesc).toContain("完成支付");
  expect(prefDesc).toContain(stepFailActual);
  const bugCreateApi = expectApi("**/api/v1/projects/*/bugs");
  const bugLinkApi = expectApi("**/api/v1/projects/*/bugs/*/cases");
  await page.getByTestId("btn-submit-new-bug").click();
  const bugCreated = await bugCreateApi;
  expect(bugCreated.status).toBe(201);
  expect(bugCreated.code).toBe(0);
  const bugLinked = await bugLinkApi;
  expect(bugLinked.status).toBe(200);
  expect(bugLinked.code).toBe(0);
  await expect(page.getByText(/已创建 BUG-\d+ 并关联用例/)).toBeVisible({ timeout: 8000 });

  // 缺陷关联可见：用户路径去缺陷详情「关联用例」Tab（bugs/[id]/page.tsx tab-cases）
  await navFromHome(page, "缺陷管理");
  await page.getByRole("link", { name: caseName }).click();
  await expect(page.getByTestId("bug-status")).toHaveText("待处理");
  await page.getByTestId("tab-cases").click();
  await expect(page.getByRole("link", { name: caseName })).toBeVisible();

  // 归档：确认弹窗 btn-archive-confirm → archived-banner 可见 + 执行入口禁用（接口断言 archive code=0）
  await navFromHome(page, "测试计划");
  await page.getByRole("link", { name: planName }).click();
  await expect(page.getByTestId("plan-cases-tab")).toBeVisible();
  await page.getByTestId("btn-archive").click();
  const archiveApi = expectApi("**/api/v1/projects/*/plans/*/archive");
  await page.getByTestId("btn-archive-confirm").click();
  const archived = await archiveApi;
  expect(archived.status).toBe(200);
  expect(archived.code).toBe(0);
  await expect(page.getByTestId("archived-banner")).toBeVisible();
  await expect(page.getByTestId("btn-link-cases")).toBeDisabled();
  await expect(
    page.getByRole("row", { name: new RegExp(caseName) }).getByRole("button", { name: "步骤执行" }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("row", { name: new RegExp(caseName) })
      .locator(".ant-select-disabled")
      .first(),
  ).toBeVisible();

  await expectNoConsoleErrors();
});

test("PLAN-001-02 重复关联与归档只读接口", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  const uniq = `D${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const planName = `只读计划-${uniq}`;
  const caseName = `只读计划用例-${uniq}`;

  // API 建计划 + 用例并关联（默认 allowDuplicate=false）
  const caseRes = await request.post(`/api/v1/projects/${projectId}/cases`, {
    data: { name: caseName },
  });
  expect(caseRes.status()).toBe(201);
  const caseId = ((await caseRes.json()) as { code: number; data: { id: string } }).data.id;
  const planRes = await request.post(`/api/v1/projects/${projectId}/plans`, {
    data: { name: planName },
  });
  expect(planRes.status()).toBe(201);
  const planBody = (await planRes.json()) as { code: number; data: { id: string } };
  expect(planBody.code).toBe(0);
  const planId = planBody.data.id;
  const linkRes = await request.post(`/api/v1/projects/${projectId}/plans/${planId}/cases`, {
    data: { caseIds: [caseId] },
  });
  expect(linkRes.status()).toBe(200);
  expect(((await linkRes.json()) as { code: number; data: { added: number } }).data.added).toBe(1);

  // 用户路径：首页 → 左侧导航「测试计划」（UI 断言计划可见；接口断言走 page.request，同源 cookie）
  await navFromHome(page, "测试计划");
  await expect(page.getByRole("row", { name: new RegExp(planName) })).toBeVisible();

  // 重复关联 → 422 code=10009 DUP_ASSOC
  const dup = await page.request.post(`/api/v1/projects/${projectId}/plans/${planId}/cases`, {
    data: { caseIds: [caseId] },
  });
  expect(dup.status()).toBe(422);
  expect(((await dup.json()) as { code: number }).code).toBe(10009);

  // 归档后再 exec → 422 code=10008 PLAN_ARCHIVED
  const detailRes = await page.request.get(`/api/v1/projects/${projectId}/plans/${planId}`);
  expect(detailRes.status()).toBe(200);
  const detail = (await detailRes.json()) as { code: number; data: { cases: { refId: string }[] } };
  const refId = detail.data.cases[0].refId;
  const archiveRes = await page.request.post(
    `/api/v1/projects/${projectId}/plans/${planId}/archive`,
  );
  expect(archiveRes.status()).toBe(200);
  expect(((await archiveRes.json()) as { code: number }).code).toBe(0);
  const execRes = await page.request.post(
    `/api/v1/projects/${projectId}/plans/${planId}/cases/${refId}/exec`,
    { data: { status: "PASS" } },
  );
  expect(execRes.status()).toBe(422);
  expect(((await execRes.json()) as { code: number }).code).toBe(10008);

  // UI：列表切「已归档」视图可见该计划（状态=已归档）
  await page.getByTestId("tab-archived-plans").click();
  const archivedRow = page.getByRole("row", { name: new RegExp(planName) });
  await expect(archivedRow).toBeVisible();
  await expect(archivedRow.getByText("已归档")).toBeVisible();

  await expectNoConsoleErrors();
});

/** coverage-audit 回补：PLAN-001 §1.2 行 3 子能力「批量修改执行人」（规格 §5 T3 声明「批量改执行人生效」从未落地）+
 *  行 2 二态「允许关联重复用例开关：开启态」（关闭态 422 10009 已由 PLAN-001-02 覆盖——开关开/关二态补齐）。
 *  期望值溯源规格 §2：重复关联开关关闭时二次关联 422；§3 工具条「批量改执行人」。
 *  实现口径注记（plan.service.ts addPlanCases）：开关开启后同用例再关联为「不拒绝、静默跳过」（added=0），
 *  规格 §2 仅定义关闭态行为，开启态明细未定义——本用例按「不再 422」断言并另关联新用例证 added=1。 */
test("PLAN-001-03 重复关联开关开启二态与批量改执行人", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `E${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const planName = `批量执行计划-${uniq}`;
  const caseAName = `批量用例A-${uniq}`;
  const caseBName = `批量用例B-${uniq}`;

  // API 造 2 用例 + 计划并关联 A（默认 allowDuplicate=false）
  const ids: string[] = [];
  for (const name of [caseAName, caseBName]) {
    const r = await request.post(`/api/v1/projects/${projectId}/cases`, { data: { name } });
    expect(r.status()).toBe(201);
    ids.push(((await r.json()) as { data: { id: string } }).data.id);
  }
  const planRes = await request.post(`/api/v1/projects/${projectId}/plans`, {
    data: { name: planName },
  });
  expect(planRes.status()).toBe(201);
  const planId = ((await planRes.json()) as { data: { id: string } }).data.id;
  const linkRes = await request.post(`/api/v1/projects/${projectId}/plans/${planId}/cases`, {
    data: { caseIds: [ids[0]] },
  });
  expect(((await linkRes.json()) as { data: { added: number } }).data.added).toBe(1);

  // 用户路径：首页 → 测试计划 → 进详情
  await navFromHome(page, "测试计划");
  await page.getByRole("link", { name: planName }).click();
  await expect(page.getByTestId("plan-cases-tab")).toBeVisible();
  await expect(page.getByTestId("plan-cases-tab")).toContainText("用例清单（1）");

  // ── 二态：开启「允许重复关联」开关（更多设置抽屉 → PUT settings） ──
  await page.getByRole("button", { name: "更多设置" }).click();
  await expect(page.getByTestId("drawer-switch-duplicate")).toBeVisible();
  await page.getByTestId("drawer-switch-duplicate").click();
  const saveApi = expectApi("**/api/v1/projects/*/plans/*");
  const saveRaw = page.waitForResponse("**/api/v1/projects/*/plans/*");
  await page.getByTestId("btn-save-plan-settings").click();
  const saved = await saveApi;
  expect(saved.status).toBe(200);
  expect(saved.code).toBe(0);
  const saveRawRes = await saveRaw;
  expect(saveRawRes.request().method()).toBe("PUT");
  expect((saveRawRes.request().postDataJSON() as { settings: { allowDuplicate: boolean } })
    .settings.allowDuplicate).toBe(true);
  await expect(page.getByText("设置已保存")).toBeVisible();

  // 开关开启后二次关联 A：不再 422（实现口径=静默跳过 added=0）；顺带关联 B（added=1）供批量执行人用
  await page.getByTestId("btn-link-cases").click();
  const linkModal = page.getByTestId("link-cases-modal");
  await expect(linkModal).toBeVisible();
  await page.getByTestId("link-cases-keyword").fill(uniq);
  for (const row of await linkModal.getByRole("row").all()) {
    const box = row.locator('input[type="checkbox"]').first(); // 展开箭头+勾选可能各含 input
    if (await box.count()) await box.check();
  }
  const relinkApi = expectApi("**/api/v1/projects/*/plans/*/cases");
  await page.getByTestId("btn-confirm-link-cases").click();
  const relinked = await relinkApi;
  expect(relinked.status).toBe(200);
  expect(relinked.code).toBe(0);
  expect((relinked.data as { added: number }).added).toBe(1); // 仅 B 新增；A 静默跳过不再 422
  await expect(page.getByTestId("plan-cases-tab")).toContainText("用例清单（2）");

  // ── 批量改执行人：勾选 2 行 → 弹窗选执行人=本人 → 确定生效 ──
  const meRes = await request.get("/api/v1/personal/me");
  const me = ((await meRes.json()) as { data: { userId: string } }).data;
  await expect(page.getByTestId("btn-batch-executor")).toBeDisabled(); // 未勾选时禁用
  for (const name of [caseAName, caseBName]) {
    await page
      .getByRole("row", { name: new RegExp(name) })
      .locator('input[type="checkbox"]')
      .first()
      .check();
  }
  await expect(page.getByTestId("btn-batch-executor")).toBeEnabled();
  await page.getByTestId("btn-batch-executor").click();
  const batchModal = page.getByRole("dialog");
  await batchModal.locator(".ant-select").first().click();
  await page
    .getByRole("option", { name: new RegExp(authedPage.email) })
    .first()
    .click();
  const execApi = expectApi("**/api/v1/projects/*/plans/*/cases/batch-executor");
  const execRaw = page.waitForResponse("**/api/v1/projects/*/plans/*/cases/batch-executor");
  await batchModal.getByRole("button", { name: /确\s*定/ }).click();
  const batched = await execApi;
  expect(batched.status).toBe(200);
  expect(batched.code).toBe(0);
  expect((batched.data as { affected: number }).affected).toBe(2);
  const execRawRes = await execRaw;
  expect(execRawRes.request().postDataJSON()).toMatchObject({
    execUserId: me.userId,
  });
  await expect(page.getByText("已更新 2 条执行人")).toBeVisible();
  // UI 断言：两行执行人列回显本人（MemberSelect label=name（email））
  for (const name of [caseAName, caseBName]) {
    await expect(
      page.getByRole("row", { name: new RegExp(name) }).getByText(authedPage.email),
    ).toBeVisible();
  }

  await expectNoConsoleErrors();
});
