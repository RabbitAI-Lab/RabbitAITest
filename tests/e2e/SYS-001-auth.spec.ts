import { test, expect, navFromHome } from './fixtures';

/** SYS-001 注册/登录/退出 + SYS-002 守卫（规格 T2/T3 映射）。 */
test('SYS-001-01 注册 → 自动登录 → 进入工作台（UI/Console/接口三类断言）', async ({ page, expectNoConsoleErrors, expectApi }) => {
  const email = `t1-${Date.now()}@rabbit.test`;
  // 用户路径：访问首页 → 守卫重定向登录页 → 点「注册」
  await page.goto('/');
  await expect(page.getByTestId('login-form')).toBeVisible();
  await page.getByRole('link', { name: '注册' }).click();
  await expect(page.getByTestId('register-page')).toBeVisible();
  await page.getByTestId('register-email').fill(email);
  await page.getByTestId('register-password').fill('rabbit-pass-123');
  await page.getByTestId('register-confirm').fill('rabbit-pass-123');
  const registerApi = expectApi('**/api/v1/auth/register');
  await page.getByTestId('register-submit').click();
  const reg = await registerApi;
  expect(reg.status).toBe(201);
  expect(reg.code).toBe(0);
  expect(reg.data).toHaveProperty('projectId');
  // UI 断言：跳转工作台，顶栏出现用户邮箱首字母头像
  await expect(page.getByTestId('topbar')).toBeVisible();
  await expect(page.getByTestId('user-avatar')).toHaveText(email.slice(0, 1).toUpperCase());
  await expectNoConsoleErrors();
});

test('SYS-001-02 重复注册 → 就地透出服务端错误（10101）', async ({ page, expectNoConsoleErrors }) => {
  const email = `t2-${Date.now()}@rabbit.test`;
  await page.goto('/register');
  await page.getByTestId('register-email').fill(email);
  await page.getByTestId('register-password').fill('rabbit-pass-123');
  await page.getByTestId('register-confirm').fill('rabbit-pass-123');
  await page.getByTestId('register-submit').click();
  await expect(page.getByTestId('topbar')).toBeVisible();
  // 登出后重复注册（API 登出清除会话，避免 middleware 将 /register 重定向回 /）
  await page.request.post('/api/v1/auth/logout');
  // 用户路径：首页（未登录被送至登录页）→ 注册
  await page.goto('/');
  await page.getByRole('link', { name: '注册' }).click();
  await page.getByTestId('register-email').fill(email);
  await page.getByTestId('register-password').fill('rabbit-pass-123');
  await page.getByTestId('register-confirm').fill('rabbit-pass-123');
  await page.getByTestId('register-submit').click();
  // UI 断言：错误 toast 透出服务端文案（react-nextjs §5.7 禁通用文案）
  await expect(page.getByText('该邮箱已注册')).toBeVisible({ timeout: 8000 });
  // 白名单：重复注册的预期 400 会被浏览器记为资源加载失败（rules/testing §3.5.1 显式登记）
  await expectNoConsoleErrors([
    { pageUrlPattern: '/register', textPattern: 'Failed to load resource.*400', reason: '重复注册预期 400' },
  ]);
});

test('SYS-001-03 登出 → 会话销毁，访问受保护页跳登录（SYS-002）', async ({ authedPage, page, expectNoConsoleErrors }) => {
  void authedPage;
  // 用户路径：首页 → 左侧菜单「测试用例」
  await navFromHome(page, '测试用例');
  await expect(page.getByTestId('case-table')).toBeVisible();
  await page.getByTestId('user-avatar').click();
  await page.getByText('退出登录').click();
  await expect(page).toHaveURL(/\/login/);
  // 例外（§3.2.2）：登出后直接访问受保护页，验证守卫重定向
  await page.goto('/cases');
  await expect(page).toHaveURL(/\/login\?next=/);
  await expectNoConsoleErrors();
});

test('SYS-002-01 未登录访问受保护页 302 → /login?next=', async ({ browser, page }) => {
  void browser;
  // 例外（§3.2.2）：未登录直接访问，验证守卫 302
  await page.goto('/debug');
  await expect(page).toHaveURL(/\/login\?next=%2Fdebug/);
  await expect(page.getByTestId('login-form')).toBeVisible();
});
