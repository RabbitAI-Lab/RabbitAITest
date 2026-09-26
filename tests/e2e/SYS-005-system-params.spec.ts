import { test, expect } from './fixtures';
import type { APIRequestContext, BrowserContext } from '@playwright/test';

/**
 * SYS-005 系统参数（docs/sprint-1-mvp-test-mgmt/SYS-005-system-params.md §5 T2）：
 * 基础 Tab 站点 URL 保存 / 数据清理下限 7 天前端拦截 / SMTP 测试连接结果回显。
 * 页面实现：apps/web/src/app/(console)/system/params/page.tsx（仅系统管理员可配置，需种子管理员会话）。
 */

/** 种子管理员登录（admin@rabbit.test；与 fixtures authedPage 同款 cookie 注入）。 */
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

test('SYS-005-01 参数保存与测试连接（管理员）', async ({ page, context, request, expectNoConsoleErrors, expectApi }) => {
  await loginSeedAdmin(request, context);

  // 用户路径：首页 → 系统设置 › 参数设置（LeftNav.tsx nav-system-params）
  await page.goto('/');
  await page.getByTestId('nav-system-params').click();
  // 基础 Tab（默认激活）：表单回显后可见
  await expect(page.getByTestId('input-site-url')).toBeVisible();

  // 基础 Tab：改站点 URL → 保存（接口断言 PUT /api/v1/system/params/basic）
  // 注：e2e 环境每轮全新 embedded-postgres（global-setup 清空 .pgdata-e2e），改站点 URL 不影响其他轮次
  const siteUrl = `https://e2e-sys005-${Date.now()}.example.com`;
  await page.getByTestId('input-site-url').fill(siteUrl);
  const saveBasicApi = expectApi('**/api/v1/system/params/basic');
  await page.getByTestId('param-save-basic').click();
  const saved = await saveBasicApi;
  expect(saved.status).toBe(200);
  expect(saved.code).toBe(0);
  // UI 断言：toast「基础配置已保存」（params/page.tsx GROUP_LABEL 拼装）
  await expect(page.getByText('基础配置已保存')).toBeVisible();

  // 数据清理 Tab：操作日志保留天数输 6（< 下限 7）→ 红字提示 + 保存禁用（UI 断言，前端防误配）
  await page.getByRole('tab', { name: '数据清理' }).click();
  await page.getByTestId('input-log-retention').fill('6');
  await expect(page.getByTestId('cleanup-invalid-hint')).toBeVisible();
  await expect(page.getByTestId('param-save-cleanup')).toBeDisabled();

  // 邮箱 Tab：测试连接 → 127.0.0.1:1 必拒（接口断言 ok=false + UI 失败明细回显）
  await page.getByRole('tab', { name: '邮箱' }).click();
  await page.getByTestId('input-smtp-host').fill('127.0.0.1');
  await page.getByTestId('input-smtp-port').fill('1');
  const smtpApi = expectApi('**/api/v1/system/params/smtp/test');
  await page.getByTestId('btn-test-smtp').click();
  const smtp = await smtpApi;
  expect(smtp.status).toBe(200);
  expect(smtp.code).toBe(0);
  expect((smtp.data as { ok: boolean }).ok).toBe(false);
  // UI 断言：message 回显失败明细（环回地址 :1 必为 ECONNREFUSED；正则兜底成功文案）
  await expect(page.getByText(/连接成功|ECONNREFUSED/)).toBeVisible({ timeout: 15000 });

  await expectNoConsoleErrors();
});
