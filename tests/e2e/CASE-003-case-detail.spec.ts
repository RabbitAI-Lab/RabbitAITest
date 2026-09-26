import type { APIRequestContext } from '@playwright/test';
import { test, expect, navFromHome } from './fixtures';

/**
 * 规格：docs/sprint-1-mvp-test-mgmt/CASE-003-case-detail-association.md §5（T2 七 Tab/依赖双向/评论/历史、T3 注入转义）
 * 选择器来源（已核对源码）：
 * - apps/web/src/app/(console)/cases/page.tsx：列表行编号链接 href=/cases/{id}（查看态）；名称/编辑链接带
 *   ?edit=1（编辑态）——进查看态详情须点编号链接 C-\d{4}
 * - apps/web/src/app/(console)/cases/[id]/page.tsx：case-breadcrumb / case-title / case-detail-tabs /
 *   tab-detail|dependencies|reviews|plans|bugs|comments|changes / btn-add-dependency / input-dep-search /
 *   select-dep-target / 前置·后置卡片标题「{标题}（{n}）」
 * - apps/web/src/components/crosscut.tsx：CommentThread（comment-input / comment-submit / comment-content /
 *   「回复」按钮）；ChangeTimeline（change-timeline，action Tag 文本=创建/更新）；MarkdownView（.md-view）
 * - 转义实现：packages/shared/src/markdown.ts（先整体 HTML 转义再标记替换 → ** → <strong>，<script> 成文本）
 * 数据隔离：authedPage 每用例独立项目；用例 A/B 均为 API 自建。
 */

interface CaseRow {
  id: string; num: number; name: string; precondition: string;
  steps: { desc: string; expect: string }[]; level: string; tags: string[];
  moduleId: string; fields: Record<string, unknown>; version: number;
}

/** API 造用例（caseCreateV2Schema：name 必填，其余缺省；POST /cases → 201） */
async function apiCreateCase(
  request: APIRequestContext, projectId: string,
  body: { name: string; precondition?: string; steps?: { desc: string; expect: string }[] },
): Promise<CaseRow> {
  const res = await request.post(`/api/v1/projects/${projectId}/cases`, {
    data: { level: 'P2', tags: [], fields: {}, ...body },
  });
  expect(res.status()).toBe(201);
  const json = (await res.json()) as { code: number; data: CaseRow };
  expect(json.code).toBe(0);
  return json.data;
}

test('CASE-003-01 详情七 Tab 与依赖双向', async ({ authedPage, page, request, expectNoConsoleErrors, expectApi }) => {
  const uniq = `${Date.now() % 100000}`;
  const nameA = `依赖主用例A${uniq}`;
  const nameB = `依赖前置用例B${uniq}`;
  const caseA = await apiCreateCase(request, authedPage.projectId, { name: nameA });
  const caseB = await apiCreateCase(request, authedPage.projectId, { name: nameB });

  // 用户路径：首页 → 测试用例 → 列表点编号链接进 A 详情（查看态；名称链接带 edit=1 是编辑态）
  await navFromHome(page, '测试用例');
  await expect(page.getByTestId('case-table')).toBeVisible();
  await page.getByRole('row', { name: new RegExp(nameA) }).getByRole('link', { name: /^C-\d{4,}$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/cases/${caseA.id}$`));

  // UI 断言：7 个 Tab 全可见 + 标题回显
  for (const tid of ['tab-detail', 'tab-dependencies', 'tab-reviews', 'tab-plans', 'tab-bugs', 'tab-comments', 'tab-changes']) {
    await expect(page.getByTestId(tid)).toBeVisible();
  }
  await expect(page.getByTestId('case-title')).toHaveText(nameA);

  // 依赖 Tab：搜索并添加前置 B（input-dep-search 过滤 → select-dep-target 选项 = `C-xxxx 名称`）
  await page.getByTestId('tab-dependencies').click();
  await expect(page.getByText('前置依赖（本用例依赖的用例）（0）')).toBeVisible();
  await page.getByTestId('btn-add-dependency').click();
  await page.getByTestId('input-dep-search').fill(nameB);
  await page.getByTestId('select-dep-target').click();
  const optionLabelB = `C-${String(caseB.num).padStart(4, '0')} ${nameB}`;
  await expect(page.getByRole('option', { name: optionLabelB })).toBeVisible({ timeout: 8000 });
  await page.getByRole('option', { name: optionLabelB }).click();
  const depApi = expectApi('**/api/v1/projects/*/cases/*/dependencies');
  // Modal okText=添加（2 字主按钮渲染「添 加」），限定弹窗作用域（页面另有「＋ 添加前置依赖」按钮）
  await page.getByRole('dialog').getByRole('button', { name: /添\s*加/ }).click();
  const dep = await depApi;
  // 接口断言：POST dependencies 201 + code=0
  expect(dep.status).toBe(201);
  expect(dep.code).toBe(0);
  // UI 断言：toast + 前置列表计数 1
  await expect(page.getByText('已添加前置依赖')).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('前置依赖（本用例依赖的用例）（1）')).toBeVisible();

  // 双向同步：面包屑回列表 → 进 B 详情 → 后置列表含 A（UI）
  await page.getByTestId('case-breadcrumb').getByRole('link', { name: '测试用例' }).click();
  await expect(page.getByTestId('case-table')).toBeVisible();
  await page.getByRole('row', { name: new RegExp(nameB) }).getByRole('link', { name: /^C-\d{4,}$/ }).click();
  await expect(page.getByTestId('case-title')).toHaveText(nameB);
  await page.getByTestId('tab-dependencies').click();
  await expect(page.getByText('后置依赖（依赖本用例的用例）（1）')).toBeVisible();
  await expect(page.getByRole('link', { name: nameA })).toBeVisible();

  // 评论 Tab：发表 + 回复（楼中楼两级）
  await page.getByTestId('case-breadcrumb').getByRole('link', { name: '测试用例' }).click();
  await expect(page.getByTestId('case-table')).toBeVisible();
  await page.getByRole('row', { name: new RegExp(nameA) }).getByRole('link', { name: /^C-\d{4,}$/ }).click();
  await expect(page.getByTestId('case-title')).toHaveText(nameA);
  await page.getByTestId('tab-comments').click();
  await page.getByTestId('comment-input').fill('首条评论');
  // glob 无法区分方法（Tab 挂载 GET 与 POST 同 URL）→ 按 method=POST 圈定（rules/testing §3.5.1 断言作用域化）
  const postComment = () =>
    page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/v1\/projects\/[^/]+\/comments\?/.test(r.url()));
  const cmtRaw = postComment();
  await page.getByTestId('comment-submit').click();
  const cmtRes = await cmtRaw;
  // 接口断言：POST comments 201 + code=0
  expect(cmtRes.status()).toBe(201);
  expect(((await cmtRes.json()) as { code: number }).code).toBe(0);
  await expect(page.getByTestId('comment-content').filter({ hasText: '首条评论' })).toBeVisible();

  await page.getByRole('button', { name: '回复', exact: true }).click();
  await page.getByTestId('comment-input').fill('回复内容');
  const replyRaw = postComment();
  await page.getByTestId('comment-submit').click();
  const replyRes = await replyRaw;
  // 接口断言：回复 POST 201 + code=0（服务端 parentId 挂主楼）
  expect(replyRes.status()).toBe(201);
  expect(((await replyRes.json()) as { code: number }).code).toBe(0);
  // UI 断言：两级评论共 2 条
  await expect(page.getByTestId('comment-content')).toHaveCount(2);
  await expect(page.getByTestId('comment-content').filter({ hasText: '回复内容' })).toBeVisible();

  // 变更历史 Tab：时间线含「创建」记录（ChangeLog action= create）
  await page.getByTestId('tab-changes').click();
  await expect(page.getByTestId('change-timeline')).toBeVisible();
  await expect(page.getByTestId('change-timeline').getByText('创建')).toBeVisible();

  await expectNoConsoleErrors();
});

test('CASE-003-02 Markdown 注入转义', async ({ authedPage, page, request, expectNoConsoleErrors }) => {
  const uniq = `${Date.now() % 100000}`;
  const caseName = `注入用例${uniq}`;
  // 同一行混合：脚本注入 + 合法粗体（renderMarkdown：整体转义后再做 ** 替换）
  const precondition = '<script>alert(1)</script> **加粗文本**';
  await apiCreateCase(request, authedPage.projectId, { name: caseName, precondition });

  // 用户路径：首页 → 测试用例 → 列表点编号进详情
  await navFromHome(page, '测试用例');
  await expect(page.getByTestId('case-table')).toBeVisible();
  await page.getByRole('row', { name: new RegExp(caseName) }).getByRole('link', { name: /^C-\d{4,}$/ }).click();
  await expect(page.getByTestId('case-title')).toHaveText(caseName);

  // DOM 断言：无 script 节点（转义为纯文本），粗体渲染为 strong
  await expect(page.locator('script:has-text("alert(1)")')).toHaveCount(0);
  await expect(page.getByText('alert(1)')).toBeVisible();
  // strong 为 markdown 渲染产物、无 ARIA 角色可寻，用组件根类 .md-view（crosscut.tsx MarkdownView）限定作用域
  await expect(page.locator('.md-view strong', { hasText: '加粗文本' })).toBeVisible();

  await expectNoConsoleErrors();
});
