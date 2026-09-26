import { test, expect } from './fixtures';

/**
 * DASH-001 工作台首页（规格：docs/sprint-1-mvp-test-mgmt/DASH-001-workbench-home.md §5 T2/T3）
 * 三类断言（rules/testing.md §3.1）：
 * - UI：dash-card-* 四卡 / dash-value-* 数字 / dash-item 待办列表 / dash-card-setting 卡片设置布局记忆
 * - Console：expectNoConsoleErrors
 * - 接口：expectApi（overview?range=3d、todo?kind=bug、preferences/dash_cards 的 status + code + data）
 * 工作台即首页（路由 /，用户路径例外允许 page.goto('/')）。
 */

test('DASH-001-01 看板与待办（我的缺陷出现→处理后消失）', async ({ authedPage, page, request, expectNoConsoleErrors, expectApi }) => {
  const { projectId } = authedPage;
  const uniq = `T${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const bugTitle = `待办缺陷-${uniq}`;

  // 首页 = 工作台（接口断言聚合 overview 信封）
  const overviewApi = expectApi('**/api/v1/projects/*/dashboard/overview*');
  await page.goto('/');
  const overview = await overviewApi;
  expect(overview.status).toBe(200);
  expect(overview.code).toBe(0);
  expect((overview.data as Record<string, unknown>).bugCard).toBeTruthy();

  // UI：四卡可见（case/review/plan/bug）且主数字元素在
  await expect(page.getByTestId('dash-home')).toBeVisible();
  for (const key of ['case', 'review', 'plan', 'bug'] as const) {
    await expect(page.getByTestId(`dash-card-${key}`)).toBeVisible();
    await expect(page.getByTestId(`dash-value-${key}`)).toBeVisible();
  }
  await expect(page.getByTestId('dash-tab-todo')).toBeVisible();

  // 造数：API 建 1 条处理人=自己的缺陷（待办口径：handle_user=me 且状态非结束态，dash.service.ts）
  const meRes = await request.get('/api/v1/personal/me');
  expect(meRes.status()).toBe(200);
  const me = ((await meRes.json()) as { code: number; data: { userId: string } }).data;
  const bugRes = await request.post(`/api/v1/projects/${projectId}/bugs`, { data: { title: bugTitle, handleUserId: me.userId } });
  expect(bugRes.status()).toBe(201);
  const bug = ((await bugRes.json()) as { code: number; data: { id: string } }).data;

  // 刷新 → 我的待办切「我的缺陷」（dash-todo-bug）→ 该缺陷出现（接口 kind=bug + UI dash-item）
  await page.reload();
  await expect(page.getByTestId('dash-home')).toBeVisible();
  const todoBugApi1 = expectApi('**/api/v1/projects/*/dashboard/todo?kind=bug*');
  await page.getByTestId('dash-todo-bug').click();
  const todo1 = await todoBugApi1;
  expect(todo1.status).toBe(200);
  expect(todo1.code).toBe(0);
  const total1 = (todo1.data as { total: number }).total;
  expect(total1).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('dash-item').filter({ hasText: bugTitle })).toBeVisible();

  // 处理它：API 流转到已关闭（待处理→处理中→已关闭，预置工作流）
  for (const toState of ['处理中', '已关闭']) {
    const tr = await request.post(`/api/v1/projects/${projectId}/bugs/${bug.id}/transition`, { data: { toState, comment: 'e2e 处理' } });
    expect(tr.status()).toBe(200);
    expect(((await tr.json()) as { code: number }).code).toBe(0);
  }

  // 刷新断言待办消失（total -1，列表无该条）
  await page.reload();
  await expect(page.getByTestId('dash-home')).toBeVisible();
  const todoBugApi2 = expectApi('**/api/v1/projects/*/dashboard/todo?kind=bug*');
  await page.getByTestId('dash-todo-bug').click();
  const todo2 = await todoBugApi2;
  expect(todo2.code).toBe(0);
  expect((todo2.data as { total: number }).total).toBe(total1 - 1);
  await expect(page.getByTestId('dash-item').filter({ hasText: bugTitle })).toHaveCount(0);

  await expectNoConsoleErrors();
});

test('DASH-001-02 时间筛选与卡片设置（布局记忆）', async ({ authedPage, page, request, expectNoConsoleErrors, expectApi }) => {
  const { projectId } = authedPage;
  const uniq = `F${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const caseName = `看板用例-${uniq}`;

  // 造数：API 造 1 用例（新项目内用例总数=1）
  const caseRes = await request.post(`/api/v1/projects/${projectId}/cases`, { data: { name: caseName } });
  expect(caseRes.status()).toBe(201);
  expect(((await caseRes.json()) as { code: number }).code).toBe(0);

  // 首页记 dash-value-case 数字 X（UI 断言）
  await page.goto('/');
  await expect(page.getByTestId('dash-card-case')).toBeVisible();
  await expect(page.getByTestId('dash-value-case')).toHaveText('1');
  const x = await page.getByTestId('dash-value-case').innerText();

  // 切近 3 天：请求必须带 range=3d（接口断言，URL glob）；数字变化或不变均以 UI 断言收口
  const rangeApi = expectApi('**/api/v1/projects/*/dashboard/overview?range=3d*');
  await page.getByTestId('dash-range').getByText('近 3 天').click();
  const ranged = await rangeApi;
  expect(ranged.status).toBe(200);
  expect(ranged.code).toBe(0);
  expect((ranged.data as { caseCard: { total: number } }).caseCard.total).toBe(1);
  const y = await page.getByTestId('dash-value-case').innerText();
  expect(y).toMatch(/^\d+$/); // 与 X 相同或变化均可，但必须是数字
  expect(x).toMatch(/^\d+$/);

  // 卡片设置：评审卡设为不展示（接口断言 user_preference 持久化 + UI 立即隐藏）
  await page.getByTestId('dash-card-setting').click();
  await expect(page.getByTestId('dash-card-popover')).toBeVisible();
  const prefApi = expectApi('**/api/v1/personal/preferences/dash_cards*');
  const reviewRow = page.getByTestId('dash-card-popover').getByText('评审卡', { exact: true }).locator('..');
  await reviewRow.getByText('不展示').click();
  const pref = await prefApi;
  expect(pref.status).toBe(200);
  expect(pref.code).toBe(0);
  expect((pref.data as { value: Record<string, string> }).value.review).toBe('hidden');
  await expect(page.getByTestId('dash-card-review')).toHaveCount(0);

  // 刷新断言布局记忆：评审卡仍不展示，其余卡仍在
  await page.reload();
  await expect(page.getByTestId('dash-card-case')).toBeVisible();
  await expect(page.getByTestId('dash-card-review')).toHaveCount(0);

  await expectNoConsoleErrors();
});
