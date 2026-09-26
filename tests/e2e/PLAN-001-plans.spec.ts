import { test, expect, navFromHome } from './fixtures';

/**
 * PLAN-001 测试计划基础（规格：docs/sprint-1-mvp-test-mgmt/PLAN-001-test-plan-basic.md §5 T2/T3）
 * 三类断言（rules/testing.md §3.1）：
 * - UI：plan-circle 通过率环 / plan-pass-rate-box 阈值徽标 / step-exec-panel 步骤面板 / archived-banner 归档横幅 / bug 详情关联用例 Tab
 * - Console：expectNoConsoleErrors
 * - 接口：expectApi（plans 创建/关联/exec/archive 的 status + code + data；payload 用 waitForResponse 补充——fixtures.expectApi 未暴露 postData）
 * 业务码（packages/shared/src/envelope.ts）：10009 DUP_ASSOC（重复关联）、10008 PLAN_ARCHIVED（归档后写操作）。
 */

test('PLAN-001-01 计划执行与缺陷带出', async ({ authedPage, page, request, expectNoConsoleErrors, expectApi }) => {
  const { projectId } = authedPage;
  const uniq = `${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const planName = `支付回归计划-${uniq}`;
  const caseName = `支付流程用例-${uniq}`;
  const stepFailActual = '支付接口超时未返回';

  // API 造 1 条含 2 步骤的用例（数据独立）
  const caseRes = await request.post(`/api/v1/projects/${projectId}/cases`, {
    data: {
      name: caseName,
      precondition: '已登录且购物车有商品',
      steps: [
        { desc: '提交订单', expect: '订单创建成功' },
        { desc: '完成支付', expect: '支付成功且回到订单页' },
      ],
    },
  });
  expect(caseRes.status()).toBe(201);
  const caseBody = (await caseRes.json()) as { code: number; data: { id: string } };
  expect(caseBody.code).toBe(0);
  const caseId = caseBody.data.id;

  // 用户路径：首页 → 左侧导航「测试计划」（LeftNav.tsx:35）→ 新建计划（阈值 80）
  await navFromHome(page, '测试计划');
  await page.getByTestId('btn-new-plan').click();
  await page.getByTestId('input-plan-name').fill(planName);
  await page.getByTestId('input-threshold').fill('80');
  const planApiP = expectApi('**/api/v1/projects/*/plans');
  const planRaw = page.waitForResponse('**/api/v1/projects/*/plans');
  await page.getByTestId('btn-submit-plan').click();
  const planCreated = await planApiP;
  expect(planCreated.status).toBe(201);
  expect(planCreated.code).toBe(0);
  const planRawRes = await planRaw;
  expect(planRawRes.request().method()).toBe('POST');
  expect((planRawRes.request().postDataJSON() as { settings: { threshold: number } }).settings.threshold).toBe(80);

  // 进详情（列表行名称链接，用户路径内跳转）
  await page.getByRole('link', { name: planName }).click();
  await expect(page.getByTestId('plan-cases-tab')).toBeVisible();

  // 关联用例（btn-link-cases → 弹窗检索勾选；payload 断言 caseIds 正确）
  await page.getByTestId('btn-link-cases').click();
  const linkModal = page.getByTestId('link-cases-modal');
  await expect(linkModal).toBeVisible();
  await page.getByTestId('link-cases-keyword').fill(caseName);
  await linkModal.getByRole('row', { name: new RegExp(caseName) }).locator('input[type="checkbox"]').check();
  const linkApi = expectApi('**/api/v1/projects/*/plans/*/cases');
  const linkRaw = page.waitForResponse('**/api/v1/projects/*/plans/*/cases');
  await page.getByTestId('btn-confirm-link-cases').click();
  const linked = await linkApi;
  expect(linked.status).toBe(200);
  expect(linked.code).toBe(0);
  expect((linked.data as { added: number }).added).toBe(1);
  const linkRawRes = await linkRaw;
  expect((linkRawRes.request().postDataJSON() as { caseIds: string[] }).caseIds).toEqual([caseId]);
  await expect(page.getByTestId('plan-cases-tab')).toContainText('用例清单（1）');

  // 行展开步骤执行面板：第一步 PASS 第二步 FAIL 填实际结果保存（接口断言 exec code=0 + payload）
  const row = page.getByRole('row', { name: new RegExp(caseName) });
  await row.getByRole('button', { name: '步骤执行' }).click();
  await expect(page.getByTestId('step-exec-panel')).toBeVisible();
  await page.getByTestId('step-btn-PASS-1').click();
  await page.getByTestId('step-btn-FAIL-2').click();
  await page.getByTestId('step-actual-2').fill(stepFailActual);
  const execApi = expectApi('**/api/v1/projects/*/plans/*/cases/*/exec');
  const execRaw = page.waitForResponse('**/api/v1/projects/*/plans/*/cases/*/exec');
  await page.getByTestId('step-exec-panel').getByRole('button', { name: '保存执行结果' }).click();
  const execRes = await execApi;
  expect(execRes.status).toBe(200);
  expect(execRes.code).toBe(0);
  expect((execRes.data as { status: string }).status).toBe('FAIL');
  const execRawRes = await execRaw;
  const execPayload = execRawRes.request().postDataJSON() as { status: string; steps: { status: string; result: string }[] };
  expect(execPayload.status).toBe('FAIL');
  expect(execPayload.steps[0].status).toBe('PASS');
  expect(execPayload.steps[1]).toMatchObject({ status: 'FAIL', result: stepFailActual });

  // 通过率环 = 50%（plan-circle）+ 未达标徽标（阈值 80，plan-pass-rate-box）
  await expect(page.getByTestId('plan-circle')).toContainText('50%');
  await expect(page.getByTestId('plan-pass-rate-box')).toContainText('阈值 80%');
  await expect(page.getByTestId('plan-pass-rate-box')).toContainText('未达标');

  // 失败行新建缺陷：标题预填用例名、描述含失败步骤（BugModal 预填，plans/[id]/page.tsx）
  await row.getByRole('button', { name: '缺陷' }).click();
  await expect(page.getByTestId('new-bug-form')).toBeVisible();
  await expect(page.getByTestId('input-bug-title')).toHaveValue(caseName);
  const prefDesc = await page.getByTestId('input-bug-desc').inputValue();
  expect(prefDesc).toContain('失败步骤');
  expect(prefDesc).toContain('完成支付');
  expect(prefDesc).toContain(stepFailActual);
  const bugCreateApi = expectApi('**/api/v1/projects/*/bugs');
  const bugLinkApi = expectApi('**/api/v1/projects/*/bugs/*/cases');
  await page.getByTestId('btn-submit-new-bug').click();
  const bugCreated = await bugCreateApi;
  expect(bugCreated.status).toBe(201);
  expect(bugCreated.code).toBe(0);
  const bugLinked = await bugLinkApi;
  expect(bugLinked.status).toBe(200);
  expect(bugLinked.code).toBe(0);
  await expect(page.getByText(/已创建 BUG-\d+ 并关联用例/)).toBeVisible({ timeout: 8000 });

  // 缺陷关联可见：用户路径去缺陷详情「关联用例」Tab（bugs/[id]/page.tsx tab-cases）
  await navFromHome(page, '缺陷管理');
  await page.getByRole('link', { name: caseName }).click();
  await expect(page.getByTestId('bug-status')).toHaveText('待处理');
  await page.getByTestId('tab-cases').click();
  await expect(page.getByRole('link', { name: caseName })).toBeVisible();

  // 归档：确认弹窗 btn-archive-confirm → archived-banner 可见 + 执行入口禁用（接口断言 archive code=0）
  await navFromHome(page, '测试计划');
  await page.getByRole('link', { name: planName }).click();
  await expect(page.getByTestId('plan-cases-tab')).toBeVisible();
  await page.getByTestId('btn-archive').click();
  const archiveApi = expectApi('**/api/v1/projects/*/plans/*/archive');
  await page.getByTestId('btn-archive-confirm').click();
  const archived = await archiveApi;
  expect(archived.status).toBe(200);
  expect(archived.code).toBe(0);
  await expect(page.getByTestId('archived-banner')).toBeVisible();
  await expect(page.getByTestId('btn-link-cases')).toBeDisabled();
  await expect(page.getByRole('row', { name: new RegExp(caseName) }).getByRole('button', { name: '步骤执行' })).toBeDisabled();
  await expect(page.getByRole('row', { name: new RegExp(caseName) }).locator('.ant-select-disabled').first()).toBeVisible();

  await expectNoConsoleErrors();
});

test('PLAN-001-02 重复关联与归档只读接口', async ({ authedPage, page, request, expectNoConsoleErrors }) => {
  const { projectId } = authedPage;
  const uniq = `D${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const planName = `只读计划-${uniq}`;
  const caseName = `只读计划用例-${uniq}`;

  // API 建计划 + 用例并关联（默认 allowDuplicate=false）
  const caseRes = await request.post(`/api/v1/projects/${projectId}/cases`, { data: { name: caseName } });
  expect(caseRes.status()).toBe(201);
  const caseId = ((await caseRes.json()) as { code: number; data: { id: string } }).data.id;
  const planRes = await request.post(`/api/v1/projects/${projectId}/plans`, { data: { name: planName } });
  expect(planRes.status()).toBe(201);
  const planBody = (await planRes.json()) as { code: number; data: { id: string } };
  expect(planBody.code).toBe(0);
  const planId = planBody.data.id;
  const linkRes = await request.post(`/api/v1/projects/${projectId}/plans/${planId}/cases`, { data: { caseIds: [caseId] } });
  expect(linkRes.status()).toBe(200);
  expect(((await linkRes.json()) as { code: number; data: { added: number } }).data.added).toBe(1);

  // 用户路径：首页 → 左侧导航「测试计划」（UI 断言计划可见；接口断言走 page.request，同源 cookie）
  await navFromHome(page, '测试计划');
  await expect(page.getByRole('row', { name: new RegExp(planName) })).toBeVisible();

  // 重复关联 → 422 code=10009 DUP_ASSOC
  const dup = await page.request.post(`/api/v1/projects/${projectId}/plans/${planId}/cases`, { data: { caseIds: [caseId] } });
  expect(dup.status()).toBe(422);
  expect(((await dup.json()) as { code: number }).code).toBe(10009);

  // 归档后再 exec → 422 code=10008 PLAN_ARCHIVED
  const detailRes = await page.request.get(`/api/v1/projects/${projectId}/plans/${planId}`);
  expect(detailRes.status()).toBe(200);
  const detail = (await detailRes.json()) as { code: number; data: { cases: { refId: string }[] } };
  const refId = detail.data.cases[0].refId;
  const archiveRes = await page.request.post(`/api/v1/projects/${projectId}/plans/${planId}/archive`);
  expect(archiveRes.status()).toBe(200);
  expect(((await archiveRes.json()) as { code: number }).code).toBe(0);
  const execRes = await page.request.post(`/api/v1/projects/${projectId}/plans/${planId}/cases/${refId}/exec`, { data: { status: 'PASS' } });
  expect(execRes.status()).toBe(422);
  expect(((await execRes.json()) as { code: number }).code).toBe(10008);

  // UI：列表切「已归档」视图可见该计划（状态=已归档）
  await page.getByTestId('tab-archived-plans').click();
  const archivedRow = page.getByRole('row', { name: new RegExp(planName) });
  await expect(archivedRow).toBeVisible();
  await expect(archivedRow.getByText('已归档')).toBeVisible();

  await expectNoConsoleErrors();
});
