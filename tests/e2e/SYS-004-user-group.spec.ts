import { test, expect } from './fixtures';
import type { APIRequestContext, BrowserContext } from '@playwright/test';

/**
 * SYS-004 用户与三级用户组管理（docs/sprint-1-mvp-test-mgmt/SYS-004-user-group-management.md §5）：
 * - SYS-004-01：管理员主链路（建用户→初始密码 Modal / 预置组只读 / 自定义组勾权限点保存）
 * - SYS-004-02：无系统权限用户——系统菜单隐藏 + 系统端点 403（code 10003）
 * 页面实现：apps/web/src/app/(console)/system/users/page.tsx、system/groups/page.tsx（GroupManager scope=system）。
 */

/** 种子管理员登录（admin@rabbit.test，tests/global-setup.mjs 执行 pnpm seed 产出）。
 *  与 fixtures authedPage 同款 cookie 注入写法（ras 会话）；按任务约定 helper 写在各文件内，不改公共 fixtures。 */
async function loginSeedAdmin(request: APIRequestContext, context: BrowserContext): Promise<void> {
  const res = await request.post('/api/v1/auth/login', {
    data: { email: 'admin@rabbit.test', password: 'rabbit-admin-123' },
  });
  expect(res.status(), '种子管理员登录应为 200（e2e 环境已 seed）').toBe(200);
  const body = (await res.json()) as { code: number };
  expect(body.code).toBe(0);
  const cookieHeader = res.headers()['set-cookie'] ?? '';
  const ras = cookieHeader.split('ras=')[1]?.split(';')[0];
  expect(ras, '登录响应应下发 ras 会话 cookie').toBeTruthy();
  await context.addCookies([{ name: 'ras', value: ras!, url: process.env.E2E_BASE_URL ?? 'http://localhost:3100' }]);
}

test('SYS-004-01 用户管理与用户组管理主链路（管理员）', async ({ page, context, request, expectNoConsoleErrors, expectApi }) => {
  // 管理员会话：系统管理页仅系统管理员可见（普通 authedPage 不适用）
  await loginSeedAdmin(request, context);
  const ts = Date.now();
  const newUserEmail = `e2e-sys004-${ts}@rabbit.test`;
  const newUserName = `SYS004用户${ts}`;
  const groupName = `只读用例组${ts}`;

  // 用户路径：首页 → 系统设置 › 用户管理（LeftNav.tsx nav-system-users）
  await page.goto('/');
  await page.getByTestId('nav-system-users').click();
  // UI 断言：用户表可见（种子管理员在列，system/users/page.tsx user-email）
  // 全量轮次中系统用户表逐用例累积（每用例注册独立用户）且按创建时间倒序——admin 不在第 1 页，
  // 用页面搜索框定位（真实用户路径），断言强度不变
  await page.getByTestId('input-user-keyword').fill('admin@rabbit.test');
  await expect(page.getByTestId('user-email').filter({ hasText: 'admin@rabbit.test' })).toBeVisible();

  // 新建用户：抽屉填邮箱/姓名 → 提交（接口断言 POST /api/v1/system/users）
  // （先清空搜索词：创建后需在「全部」列表断言新用户在列——新用户创建时间最新、必在第 1 页）
  await page.getByTestId('input-user-keyword').fill('');
  await page.getByTestId('btn-new-user').click();
  await page.getByTestId('input-user-email').fill(newUserEmail);
  await page.getByTestId('input-user-name').fill(newUserName);
  const createUserApi = expectApi('**/api/v1/system/users');
  await page.getByTestId('btn-submit-user').click();
  const created = await createUserApi;
  expect(created.status).toBe(201);
  expect(created.code).toBe(0);
  // UI 断言：Modal 展示一次性初始密码（initial-password），且新用户出现在列表
  await expect(page.getByTestId('initial-password')).toBeVisible();
  await expect(page.getByTestId('initial-password')).not.toHaveText('');
  await expect(page.getByTestId('user-email').filter({ hasText: newUserEmail })).toBeVisible();
  // 关闭初始密码 Modal（antd zh_CN 单按钮 Modal.success 为「知道了」；避免后续 dialog 定位歧义）
  await page.getByRole('dialog').getByRole('button', { name: '知道了' }).click();

  // 用户路径：左导航 → 系统设置 › 用户组（GroupManager scope=system）
  await page.getByTestId('nav-system-groups').click();
  await expect(page.getByTestId('btn-new-group')).toBeVisible();
  // UI 断言：预置组「系统成员」只读提示（GroupManager.tsx Alert banner）
  await page.getByTestId('group-item-系统成员').click();
  await expect(page.getByText('预置组不可修改，仅可查看成员与权限')).toBeVisible();

  // 新建自定义组（接口断言 POST /api/v1/system/groups）
  await page.getByTestId('btn-new-group').click();
  await page.getByTestId('input-new-group-name').fill(groupName);
  const createGroupApi = expectApi('**/api/v1/system/groups');
  // Modal okText=创建（2 字主按钮渲染「创 建」），正则兼容
  await page.getByRole('dialog').getByRole('button', { name: /创\s*建/ }).click();
  const group = await createGroupApi;
  expect(group.status).toBe(201);
  expect(group.code).toBe(0);

  // 选中新建组 → 仅勾 PROJECT_CASE:READ → 保存权限（接口断言 PUT /api/v1/system/groups/{id}）
  await page.getByTestId(`group-item-${groupName}`).click();
  await page.getByTestId('perm-check-PROJECT_CASE:READ').check();
  const savePermApi = expectApi('**/api/v1/system/groups/*');
  await page.getByTestId('btn-save-group').click();
  const saved = await savePermApi;
  expect(saved.status).toBe(200);
  expect(saved.code).toBe(0);
  // UI 断言：保存成功提示
  await expect(page.getByText('权限已保存并即时生效')).toBeVisible();

  await expectNoConsoleErrors();
});

test('SYS-004-02 无系统权限用户 403（菜单隐藏 + code 10003）', async ({ authedPage, page, expectNoConsoleErrors, expectApi }) => {
  // authedPage = 普通注册用户（仅自己组织/项目的管理员组，无任何 SYSTEM_* 权限点）
  // 用户路径：首页（确认会话与导航渲染）
  await page.goto('/');
  await expect(page.getByTestId('topbar')).toBeVisible();
  // UI 断言：左侧导航无系统管理入口（LeftNav 按 SYSTEM_USER:READ/SYSTEM_GROUP:READ 过滤）
  await expect(page.getByTestId('nav-system-users')).toHaveCount(0);
  await expect(page.getByTestId('nav-system-groups')).toHaveCount(0);

  // §3.2.2 例外（守卫类断言）：直访 /system/users——页面可达，但数据接口 403
  const listApi = expectApi('**/api/v1/system/users*');
  await page.goto('/system/users');
  await expect(page.getByText('用户管理', { exact: true })).toBeVisible();
  const list = await listApi;
  expect(list.status).toBe(403);
  expect(list.code).toBe(10003);

  // 接口断言：浏览器上下文复用会话直发写接口 → 403 code 10003（rbac §4）
  const res = await page.request.post('/api/v1/system/users', {
    data: { email: `e2e-403-${Date.now()}@rabbit.test`, name: '无权限用户' },
  });
  expect(res.status()).toBe(403);
  const body = (await res.json()) as { code: number; message: string };
  expect(body.code).toBe(10003);

  await expectNoConsoleErrors([
    // 普通用户打开用户管理页：列表接口预期 403，浏览器记为资源加载失败（§3.5.1 显式登记）
    { pageUrlPattern: '/system/users', textPattern: 'Failed to load resource.*403', reason: '普通用户无 SYSTEM_USER:READ，列表预期 403' },
  ]);
});
