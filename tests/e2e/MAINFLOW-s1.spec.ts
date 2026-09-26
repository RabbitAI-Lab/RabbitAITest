import { test, expect, navFromHome } from './fixtures';

/**
 * Sprint 1 主链路 E2E（sprint-overview 验收 8/需求文档 §二）—— Release Gate。
 * 链路：登录 → 建模块树两级 → 造用例（挂子模块）→ 建评审关联并标记通过 → 建计划（阈值 100）关联
 * → 逐条执行（1 PASS 1 FAIL 含步骤级）→ 失败行新建缺陷（带出步骤）→ 归档计划 → 回工作台断言看板数字。
 * 规格：docs/sprint-1-mvp-test-mgmt/（CASE-002/005、PLAN-001、BUG-001、DASH-001）。
 * 三类断言（rules/testing.md §3.1）：UI（各页 testid）+ Console（expectNoConsoleErrors）+ 接口（≥5 个
 * expectApi：modules/reviews/reviews-cases/judge/plans/plans-cases/exec×2/bugs/bugs-cases/archive/overview）；
 * payload 用 waitForResponse 补充（fixtures.expectApi 未暴露 postData）。
 * 用户路径：每环节从左侧导航进入（navFromHome / leftnav 内点击），工作台首页除外，禁止 goto 直跳业务页。
 */

test('MAINFLOW-s1 Sprint1 主链路（模块树→用例→评审→计划→执行→缺陷→看板）', async ({ authedPage, page, request, expectNoConsoleErrors, expectApi }) => {
  const { projectId } = authedPage;
  const uniq = `MF${Date.now() % 1e8}${Math.floor(Math.random() * 1e4)}`;
  const rootName = `主链路模块-${uniq}`;
  const childName = `子模块-${uniq}`;
  const caseAName = `${uniq}-登录场景`;
  const caseBName = `${uniq}-支付场景`;
  const reviewName = `主链路评审-${uniq}`;
  const planName = `主链路计划-${uniq}`;
  const stepBFailActual = '支付接口超时';

  // ── 0. 登录态会话注入（authedPage）→ 工作台首页 ──
  await page.goto('/');
  await expect(page.getByTestId('dash-home')).toBeVisible();

  // ── 1. 建模块树两级（/cases 左侧模块树：+根模块 → 右键「新建子模块」）──
  await navFromHome(page, '测试用例');
  await expect(page.getByTestId('case-table')).toBeVisible();
  await expect(page.getByTestId('module-panel-case')).toBeVisible();
  await page.getByTestId('module-add-root').click();
  const modRootApi = expectApi('**/api/v1/projects/*/modules?scene=case');
  await page.locator('.ant-modal input[placeholder="模块名称"]').fill(rootName);
  await page.locator('.ant-modal').getByRole('button', { name: /确\s*定/ }).click();
  const modRoot = await modRootApi;
  expect(modRoot.status).toBe(201);
  expect(modRoot.code).toBe(0);
  await expect(page.getByTestId(`module-node-${rootName}`)).toBeVisible();

  await page.getByTestId(`module-node-${rootName}`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '新建子模块' }).click();
  const modChildApi = expectApi('**/api/v1/projects/*/modules?scene=case');
  await page.locator('.ant-modal input[placeholder="模块名称"]').fill(childName);
  await page.locator('.ant-modal').getByRole('button', { name: /确\s*定/ }).click();
  const modChild = await modChildApi;
  expect(modChild.status).toBe(201);
  expect(modChild.code).toBe(0);
  await expect(page.getByText('模块已创建')).toBeVisible({ timeout: 8000 });
  // defaultExpandAll 仅作用于初始渲染：根模块最初是叶子，新增子级后需展开其 switcher 才可见（已在展开态则跳过）
  const childNode = page.getByTestId(`module-node-${childName}`);
  if (!(await childNode.isVisible())) {
    await page.locator('.ant-tree-treenode').filter({ has: page.getByTestId(`module-node-${rootName}`) })
      .locator('.ant-tree-switcher').click();
  }
  await expect(childNode).toBeVisible();

  // ── 2. API 造用例 2 条（挂子模块：A 1 步骤 / B 2 步骤）──
  const modsRes = await request.get(`/api/v1/projects/${projectId}/modules?scene=case`);
  expect(modsRes.status()).toBe(200);
  const mods = ((await modsRes.json()) as {
    code: number; data: { items: { id: string; name: string; children: { id: string; name: string }[] }[] };
  }).data.items;
  const childId = mods.flatMap((n) => n.children).find((c) => c.name === childName)?.id;
  expect(childId, '子模块应存在').toBeTruthy();
  for (const body of [
    { name: caseAName, precondition: '已注册账号', steps: [{ desc: '输入正确账号密码点击登录', expect: '跳转工作台' }] },
    { name: caseBName, precondition: '已登录且购物车有商品', steps: [
      { desc: '提交订单', expect: '订单创建成功' },
      { desc: '完成支付', expect: '支付成功且回到订单页' },
    ] },
  ]) {
    const r = await request.post(`/api/v1/projects/${projectId}/cases`, { data: { ...body, moduleId: childId } });
    expect(r.status()).toBe(201);
    expect(((await r.json()) as { code: number }).code).toBe(0);
  }

  // ── 3. 建评审（评审人=自己）→ 关联 2 条 → 逐条标记通过 ──
  await navFromHome(page, '用例评审');
  await page.getByTestId('btn-new-review').click();
  await page.getByTestId('input-review-name').fill(reviewName);
  await page.locator('.ant-modal').getByText('选择评审人（可多选）').click();
  await page.getByRole('option').filter({ hasText: authedPage.email }).click();
  // 点击他处收起成员下拉（不用 Escape，避免误关 Modal）
  await page.getByTestId('input-review-name').click();
  const reviewApiP = expectApi('**/api/v1/projects/*/reviews');
  await page.getByTestId('btn-submit-review').click();
  const reviewCreated = await reviewApiP;
  expect(reviewCreated.status).toBe(201);
  expect(reviewCreated.code).toBe(0);
  // 创建成功自动进入评审详情（用户路径内跳转）
  await expect(page.getByTestId('review-case-list')).toBeVisible();

  await page.getByTestId('btn-add-review-cases').click();
  const reviewLinkModal = page.getByTestId('link-cases-modal');
  await page.getByTestId('link-cases-keyword').fill(uniq);
  await reviewLinkModal.getByRole('row', { name: new RegExp(caseAName) }).locator('input[type="checkbox"]').check();
  await reviewLinkModal.getByRole('row', { name: new RegExp(caseBName) }).locator('input[type="checkbox"]').check();
  const reviewLinkApi = expectApi('**/api/v1/projects/*/reviews/*/cases');
  await page.getByTestId('btn-confirm-link-cases').click();
  const reviewLinked = await reviewLinkApi;
  expect(reviewLinked.status).toBe(200);
  expect(reviewLinked.code).toBe(0);
  expect((reviewLinked.data as { added: number }).added).toBe(2);

  for (const caseName of [caseAName, caseBName]) {
    await page.getByTestId('review-case-list').getByText(caseName).click();
    await page.getByTestId('judge-btn-PASS').click();
    const judgeApi = expectApi('**/api/v1/projects/*/reviews/*/cases/*/judge');
    await page.getByTestId('btn-submit-judge').click();
    const judged = await judgeApi;
    expect(judged.status).toBe(200);
    expect(judged.code).toBe(0);
    expect((judged.data as { result: string }).result).toBe('PASS');
  }
  await expect(page.getByText('已评 2 / 2')).toBeVisible();
  await expect(page.getByTestId('review-circle')).toContainText('100%');

  // ── 4. 建计划（阈值 100）→ 关联 2 条 ──
  await navFromHome(page, '测试计划');
  await page.getByTestId('btn-new-plan').click();
  await page.getByTestId('input-plan-name').fill(planName);
  await page.getByTestId('input-threshold').fill('100');
  const planApiP = expectApi('**/api/v1/projects/*/plans');
  await page.getByTestId('btn-submit-plan').click();
  const planCreated = await planApiP;
  expect(planCreated.status).toBe(201);
  expect(planCreated.code).toBe(0);
  await page.getByRole('link', { name: planName }).click();
  await expect(page.getByTestId('plan-cases-tab')).toBeVisible();

  await page.getByTestId('btn-link-cases').click();
  const planLinkModal = page.getByTestId('link-cases-modal');
  await page.getByTestId('link-cases-keyword').fill(uniq);
  await planLinkModal.getByRole('row', { name: new RegExp(caseAName) }).locator('input[type="checkbox"]').check();
  await planLinkModal.getByRole('row', { name: new RegExp(caseBName) }).locator('input[type="checkbox"]').check();
  const planLinkApi = expectApi('**/api/v1/projects/*/plans/*/cases');
  await page.getByTestId('btn-confirm-link-cases').click();
  const planLinked = await planLinkApi;
  expect(planLinked.status).toBe(200);
  expect(planLinked.code).toBe(0);
  expect((planLinked.data as { added: number }).added).toBe(2);
  await expect(page.getByTestId('plan-cases-tab')).toContainText('用例清单（2）');

  // ── 5. 逐条执行：A 步骤级 PASS；B 步骤级 1 PASS 2 FAIL（含实际结果）──
  const rowA = page.getByRole('row', { name: new RegExp(caseAName) });
  await rowA.getByRole('button', { name: '步骤执行' }).click();
  await expect(page.getByTestId('step-exec-panel')).toBeVisible();
  await page.getByTestId('step-btn-PASS-1').click();
  const execA = expectApi('**/api/v1/projects/*/plans/*/cases/*/exec');
  await page.getByTestId('step-exec-panel').getByRole('button', { name: '保存执行结果' }).click();
  const executedA = await execA;
  expect(executedA.code).toBe(0);
  expect((executedA.data as { status: string }).status).toBe('PASS');
  await rowA.getByRole('button', { name: '步骤执行' }).click(); // 收起 A，保证面板唯一

  const rowB = page.getByRole('row', { name: new RegExp(caseBName) });
  await rowB.getByRole('button', { name: '步骤执行' }).click();
  await expect(page.getByTestId('step-exec-panel')).toBeVisible();
  await page.getByTestId('step-btn-PASS-1').click();
  await page.getByTestId('step-btn-FAIL-2').click();
  await page.getByTestId('step-actual-2').fill(stepBFailActual);
  const execB = expectApi('**/api/v1/projects/*/plans/*/cases/*/exec');
  const execBRaw = page.waitForResponse('**/api/v1/projects/*/plans/*/cases/*/exec');
  await page.getByTestId('step-exec-panel').getByRole('button', { name: '保存执行结果' }).click();
  const executedB = await execB;
  expect(executedB.code).toBe(0);
  expect((executedB.data as { status: string }).status).toBe('FAIL');
  const execBRawRes = await execBRaw;
  const execBPayload = execBRawRes.request().postDataJSON() as { status: string; steps: { status: string; result: string }[] };
  expect(execBPayload.steps[1]).toMatchObject({ status: 'FAIL', result: stepBFailActual });

  // 通过率 50%（1/2）< 阈值 100 → 未达标
  await expect(page.getByTestId('plan-circle')).toContainText('50%');
  await expect(page.getByTestId('plan-pass-rate-box')).toContainText('未达标');

  // ── 6. 失败行新建缺陷（标题预填用例名、描述带出失败步骤）并关联用例 ──
  await rowB.getByRole('button', { name: '缺陷' }).click();
  await expect(page.getByTestId('new-bug-form')).toBeVisible();
  await expect(page.getByTestId('input-bug-title')).toHaveValue(caseBName);
  expect(await page.getByTestId('input-bug-desc').inputValue()).toContain('失败步骤');
  const bugCreateApi = expectApi('**/api/v1/projects/*/bugs');
  const bugLinkApi = expectApi('**/api/v1/projects/*/bugs/*/cases');
  await page.getByTestId('btn-submit-new-bug').click();
  const bugCreated = await bugCreateApi;
  expect(bugCreated.status).toBe(201);
  expect(bugCreated.code).toBe(0);
  expect((await bugLinkApi).code).toBe(0);
  await expect(page.getByText(/已创建 BUG-\d+ 并关联用例/)).toBeVisible({ timeout: 8000 });

  // ── 7. 归档计划（只读横幅）──
  await page.getByTestId('btn-archive').click();
  const archiveApi = expectApi('**/api/v1/projects/*/plans/*/archive');
  await page.getByTestId('btn-archive-confirm').click();
  const archived = await archiveApi;
  expect(archived.status).toBe(200);
  expect(archived.code).toBe(0);
  await expect(page.getByTestId('archived-banner')).toBeVisible();

  // ── 8. 回工作台（leftnav 内点击）断言看板数字：用例总数=2、缺陷待处理≥1 ──
  const overviewApi = expectApi('**/api/v1/projects/*/dashboard/overview*');
  await page.getByTestId('leftnav').getByRole('link', { name: '工作台' }).click();
  const overview = await overviewApi;
  expect(overview.code).toBe(0);
  await expect(page.getByTestId('dash-value-case')).toHaveText('2');
  const bugPending = Number(await page.getByTestId('dash-value-bug').innerText());
  expect(bugPending).toBeGreaterThanOrEqual(1);

  await expectNoConsoleErrors();
});
