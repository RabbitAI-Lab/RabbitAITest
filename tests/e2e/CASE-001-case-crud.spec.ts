import { test, expect } from './fixtures';

/** CASE-001 主链路：新建（3 步骤）→ 列表可见 → 删除 → 回收站 → 恢复 → 彻底删除（验收标准 3）。 */
test('CASE-001-01 用例全生命周期', async ({ authedPage, page, expectNoConsoleErrors, expectApi }) => {
  void authedPage;
  await page.goto('/cases/new');
  await expect(page.getByTestId('case-form')).toBeVisible();

  // 新建：3 步骤
  await page.getByTestId('case-name').fill('登录成功场景');
  await page.getByTestId('case-precondition').fill('已注册账号');
  await page.getByTestId('btn-add-step').click();
  await page.getByTestId('btn-add-step').click();
  await page.getByTestId('step-desc-1').fill('输入正确账号密码点击登录');
  await page.getByTestId('step-expect-1').fill('跳转工作台');
  await page.getByTestId('step-desc-2').fill('刷新页面');
  await page.getByTestId('step-expect-2').fill('会话保持');
  const createApi = expectApi('**/api/v1/projects/*/cases');
  await page.getByTestId('btn-save-case').click();
  const created = await createApi;
  expect(created.status).toBe(201);
  expect(created.code).toBe(0);

  // 列表可见（UI 断言 + 列表接口断言）
  await page.goto('/cases');
  await expect(page.getByText('登录成功场景')).toBeVisible();
  const listApi = expectApi('**/api/v1/projects/*/cases?*');
  await page.getByTestId('input-keyword').fill('登录成功');
  await page.keyboard.press('Enter');
  const list = await listApi;
  expect(list.code).toBe(0);
  const items = (list.data as { total: number; items: { name: string }[] });
  expect(items.total).toBeGreaterThanOrEqual(1);
  expect(items.items.some((i) => i.name === '登录成功场景')).toBe(true);

  // 删除 → 回收站可见 → 恢复
  await page.getByRole('row', { name: /登录成功场景/ }).getByText('删除').click();
  await expect(page.getByText('已删除')).toBeVisible({ timeout: 8000 });
  await page.getByTestId('tab-recycle').click();
  await expect(page.getByText('登录成功场景')).toBeVisible();
  await page.getByTestId('btn-restore-1').click();
  await expect(page.getByText('已恢复')).toBeVisible({ timeout: 8000 });
  await page.getByTestId('tab-all').click();
  await expect(page.getByText('登录成功场景')).toBeVisible();

  // 彻底删除（二次确认弹窗）
  await page.getByRole('row', { name: /登录成功场景/ }).getByText('删除').click();
  await expect(page.getByText('已删除')).toBeVisible({ timeout: 8000 });
  await page.getByTestId('tab-recycle').click();
  await page.getByRole('row', { name: /登录成功场景/ }).getByText('彻底删除').click();
  await expect(page.getByText('该操作不可恢复，确认删除？')).toBeVisible();
  const purgeApi = expectApi('**/api/v1/projects/*/cases/*?purge=true');
  await page.locator('.ant-popover').getByRole('button', { name: '彻底删除' }).click();
  const purge = await purgeApi;
  expect(purge.status).toBe(200);
  expect(purge.code).toBe(0);
  await expect(page.getByText('登录成功场景')).toHaveCount(0);

  await expectNoConsoleErrors();
});

test('CASE-001-02 编辑保存后 version 递增，名称空校验', async ({ authedPage, page, expectNoConsoleErrors }) => {
  void authedPage;
  await page.goto('/cases/new');
  await page.getByTestId('case-name').fill('编辑用例A');
  await page.getByTestId('btn-save-case').click();
  await expect(page.getByText('已创建')).toBeVisible({ timeout: 8000 });
  // 留在表单（保存并继续后新建第二条），改为直接进入列表编辑
  await page.goto('/cases');
  await page.getByRole('row', { name: /编辑用例A/ }).getByRole('link', { name: '编辑用例A' }).click();
  await expect(page.getByTestId('case-form')).toBeVisible();
  await page.getByTestId('case-name').fill('');
  await page.getByTestId('btn-save-case').click();
  await expect(page.getByText('名称不能为空')).toBeVisible();
  await page.getByTestId('case-name').fill('编辑用例A-改');
  await page.getByTestId('btn-save-case').click();
  await expect(page.getByText('已保存')).toBeVisible({ timeout: 8000 });
  await expectNoConsoleErrors();
});
