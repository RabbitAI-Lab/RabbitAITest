import { test, expect } from './fixtures';

/**
 * PROJ-001 项目成员、项目级权限与项目生命周期（docs/sprint-1-mvp-test-mgmt/PROJ-001-project-permission.md §5 T2/T3）：
 * - PROJ-001-01：模块开关（关闭缺陷→菜单隐藏→恢复）+ 组织项目删除→已删除页签→撤销恢复
 * - PROJ-001-02：成员管理（注册创建者在成员表内）
 * 页面实现：settings/info/page.tsx、org/projects/page.tsx、settings/members/page.tsx、LeftNav.tsx。
 */

test('PROJ-001-01 模块开关与删除撤销', async ({ authedPage, page, expectNoConsoleErrors, expectApi }) => {
  void authedPage;
  const ts = Date.now();
  const projectName = `E2E撤销项目${ts}`;

  // 用户路径：首页 → 项目设置 › 基本信息
  await page.goto('/');
  await page.getByTestId('nav-settings-info').click();
  await expect(page.getByTestId('project-info-form')).toBeVisible();
  await expect(page.getByTestId('module-switch-bug')).toBeVisible();

  // 关闭「缺陷管理」开关 → 保存（接口断言 PUT /api/v1/projects/{pid}）
  await page.getByTestId('module-switch-bug').click();
  // UI 断言：开关旁出现「已关闭」提示
  await expect(page.getByText('已关闭：菜单隐藏，数据保留，可随时开启')).toBeVisible();
  const saveOffApi = expectApi('**/api/v1/projects/*');
  await page.getByTestId('btn-save-info').click();
  const savedOff = await saveOffApi;
  expect(savedOff.status).toBe(200);
  expect(savedOff.code).toBe(0);
  await expect(page.getByText('基本信息已保存')).toBeVisible();
  // UI 断言：左侧导航缺陷入口隐藏。
  // 注：读 middleware.ts 确认 matcher 不含 /bugs、bugs 页面无模块守卫——直访不重定向，故以「菜单隐藏」为断言口径（PROJ-001 §2 的 UI 收敛语义）
  await expect(page.getByTestId('nav-bugs')).toHaveCount(0);

  // 回设置重新开启 → 保存 → 菜单恢复（接口断言第二次 PUT）
  await page.getByTestId('module-switch-bug').click();
  const saveOnApi = expectApi('**/api/v1/projects/*');
  await page.getByTestId('btn-save-info').click();
  const savedOn = await saveOnApi;
  expect(savedOn.status).toBe(200);
  expect(savedOn.code).toBe(0);
  await expect(page.getByTestId('nav-bugs')).toBeVisible();

  // 用户路径：左导航 → 组织 › 项目管理（nav-org-projects）
  await page.getByTestId('nav-org-projects').click();
  await expect(page.getByRole('row', { name: /演示项目/ })).toBeVisible();

  // 新建项目（接口断言 POST /api/v1/orgs/{org}/projects）
  await page.getByTestId('btn-new-project').click();
  await page.getByTestId('input-new-project-name').fill(projectName);
  const createApi = expectApi('**/api/v1/orgs/*/projects');
  await page.getByRole('dialog').getByRole('button', { name: '创建' }).click();
  const created = await createApi;
  expect(created.status).toBe(201);
  expect(created.code).toBe(0);
  await expect(page.getByText('项目已创建')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(projectName) })).toBeVisible();

  // 删除：行内删除 → Modal 二次确认（明示 30 天可撤销）→ 确认（接口断言 DELETE /api/v1/projects/{pid}）
  await page.getByRole('row', { name: new RegExp(projectName) }).getByTestId('btn-delete-project').click();
  await expect(page.getByText(/30 天内可在「已删除」页签撤销恢复/)).toBeVisible();
  const deleteApi = expectApi('**/api/v1/projects/*');
  await page.getByRole('dialog').getByRole('button', { name: '确认删除' }).click();
  const deleted = await deleteApi;
  expect(deleted.status).toBe(200);
  expect(deleted.code).toBe(0);
  await expect(page.getByText(/项目已删除/)).toBeVisible();

  // 「已删除」页签出现该项目 → 撤销恢复（接口断言 POST restore）→ 回「项目列表」页签
  await page.getByTestId('tab-deleted').click();
  await expect(page.getByRole('row', { name: new RegExp(projectName) })).toBeVisible();
  const restoreApi = expectApi('**/api/v1/projects/*/restore');
  await page.getByRole('row', { name: new RegExp(projectName) }).getByTestId('btn-restore-project').click();
  const restored = await restoreApi;
  expect(restored.status).toBe(200);
  expect(restored.code).toBe(0);
  await expect(page.getByText('项目已恢复')).toBeVisible();
  await page.getByTestId('tab-list').click();
  await expect(page.getByRole('row', { name: new RegExp(projectName) })).toBeVisible();

  await expectNoConsoleErrors();
});

test('PROJ-001-02 成员管理：注册创建者即项目成员', async ({ authedPage, page, expectNoConsoleErrors, expectApi }) => {
  // 用户路径：首页 → 项目设置 › 成员管理（nav-settings-members；先挂接口监听再导航，捕获首屏列表请求）
  await page.goto('/');
  const membersApi = expectApi('**/api/v1/projects/*/members*');
  await page.getByTestId('nav-settings-members').click();

  // 接口断言：成员分页信封 code=0 且包含本人
  const members = await membersApi;
  expect(members.status).toBe(200);
  expect(members.code).toBe(0);
  const data = members.data as { total: number; items: { email: string }[] };
  expect(data.total).toBeGreaterThanOrEqual(1);
  expect(data.items.some((m) => m.email === authedPage.email)).toBe(true);

  // UI 断言：成员表（member-email）含创建者本人邮箱
  await expect(page.getByTestId('member-email').filter({ hasText: authedPage.email })).toBeVisible();

  await expectNoConsoleErrors();
});
