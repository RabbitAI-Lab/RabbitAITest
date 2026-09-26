import { test, expect, navFromHome } from './fixtures';

/**
 * BUG-001 本地缺陷管理（规格：docs/sprint-1-mvp-test-mgmt/BUG-001-local-bug-management.md §5 T2/T3）
 * 三类断言（rules/testing.md §3.1）：
 * - UI：bug-table / bug-status / tab-comments / comment-content / tab-history / change-timeline / tab-recycle
 * - Console：expectNoConsoleErrors
 * - 接口：expectApi（create/transition/restore 的 status + code + data；payload 用 waitForResponse 补充——fixtures.expectApi 未暴露 postData）
 * 工作流预置（packages/db/src/presets.ts：待处理→处理中→已关闭，已关闭→待处理）：
 * 从「待处理」出发 allowedTransitions 仅含「处理中」。
 */

test('BUG-001-01 缺陷全流程（新建→流转→评论→变更历史）', async ({ authedPage, page, expectNoConsoleErrors, expectApi }) => {
  const { projectId } = authedPage;
  const uniq = `${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const bugTitle = `登录失败-${uniq}`;
  void projectId;

  // 用户路径：首页 → 左侧导航「缺陷管理」（LeftNav.tsx:36）
  await navFromHome(page, '缺陷管理');
  await expect(page.getByTestId('bug-table')).toBeVisible();

  // 新建：填标题提交（bugs/new/page.tsx：input-bug-title / btn-submit-bug）
  await page.getByTestId('btn-new-bug').click();
  await expect(page.getByTestId('bug-form')).toBeVisible();
  await page.getByTestId('input-bug-title').fill(bugTitle);
  const createApi = expectApi('**/api/v1/projects/*/bugs');
  await page.getByTestId('btn-submit-bug').click();
  const created = await createApi;
  expect(created.status).toBe(201);
  expect(created.code).toBe(0);
  expect((created.data as { num: number; status: string }).num).toBeGreaterThanOrEqual(1);
  expect((created.data as { num: number; status: string }).status).toBe('待处理');

  // 保存后自动跳详情（bugs/[id]/page.tsx）
  await expect(page).toHaveURL(/\/bugs\/[\w-]+$/, { timeout: 8000 });
  // 初始状态徽标 = 待处理（工作流 start 态），流转按钮组按 allowedTransitions 渲染
  await expect(page.getByTestId('bug-status')).toHaveText('待处理');
  await expect(page.getByTestId('btn-transition-处理中')).toBeVisible();

  // 流转 待处理→处理中：弹窗填意见确认（接口断言 code=0 + payload toState/comment）
  const transitionApi = expectApi('**/api/v1/projects/*/bugs/*/transition');
  const transitionRaw = page.waitForResponse('**/api/v1/projects/*/bugs/*/transition');
  await page.getByTestId('btn-transition-处理中').click();
  await page.getByTestId('input-transition-comment').fill('开始排查登录失败');
  await page.getByRole('button', { name: '确认流转' }).click();
  const trans = await transitionApi;
  expect(trans.status).toBe(200);
  expect(trans.code).toBe(0);
  expect((trans.data as { status: string }).status).toBe('处理中');
  const transRes = await transitionRaw;
  expect(transRes.request().method()).toBe('POST');
  expect(transRes.request().postDataJSON()).toMatchObject({ toState: '处理中', comment: '开始排查登录失败' });
  // UI：状态徽标变为处理中
  await expect(page.getByTestId('bug-status')).toHaveText('处理中');

  // 评论 Tab：发表评论（crosscut.tsx CommentThread：comment-input / comment-submit / comment-content）
  // glob 无法区分方法：先消费 Tab 挂载触发的 GET 评论列表，再等 POST（否则 expectApi 可能误捕 GET）
  const commentsLoad = page.waitForResponse('**/api/v1/projects/*/comments?entity=*');
  await page.getByTestId('tab-comments').click();
  await commentsLoad;
  await expect(page.getByText('暂无评论')).toBeVisible(); // 流转评论以【流转】前缀过滤，主列表为空
  await page.getByTestId('comment-input').fill('已定位为密码校验缺陷');
  const commentApi = expectApi('**/api/v1/projects/*/comments?entity=*');
  await page.getByTestId('comment-submit').click();
  const commented = await commentApi;
  expect(commented.status).toBe(201);
  expect(commented.code).toBe(0);
  await expect(page.getByTestId('comment-content').filter({ hasText: '已定位为密码校验缺陷' })).toBeVisible();

  // 变更历史 Tab：有流转记录（实现口径：从评论【流转 x→y】前缀过滤生成时间线，bugs/[id]/page.tsx）
  await page.getByTestId('tab-history').click();
  await expect(page.getByTestId('change-timeline')).toBeVisible();
  await expect(page.getByTestId('change-timeline')).toContainText('流转');
  await expect(page.getByTestId('change-timeline')).toContainText('待处理');
  await expect(page.getByTestId('change-timeline')).toContainText('处理中');

  await expectNoConsoleErrors();
});

test('BUG-001-02 回收站恢复与非法流转（allowedTransitions 驱动）', async ({ authedPage, page, request, expectNoConsoleErrors, expectApi }) => {
  const { projectId } = authedPage;
  const uniq = `R${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const bugTitle = `回收站缺陷-${uniq}`;

  // API 造缺陷（数据独立：每用例独立注册用户 + 项目）
  const created = await request.post(`/api/v1/projects/${projectId}/bugs`, { data: { title: bugTitle } });
  expect(created.status()).toBe(201);
  const createdBody = (await created.json()) as { code: number; data: { id: string } };
  expect(createdBody.code).toBe(0);

  // 用户路径：首页 → 左侧导航「缺陷管理」→ 列表删除（软删进回收站）
  await navFromHome(page, '缺陷管理');
  await expect(page.getByTestId('bug-table')).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(bugTitle) });
  await row.getByRole('button', { name: '删除' }).click();
  await page.locator('.ant-popover').getByRole('button', { name: /确\s*定/ }).click();
  await expect(page.getByText('已删除（进入回收站，可恢复）')).toBeVisible({ timeout: 8000 });

  // 回收站 → 恢复（接口断言 restore code=0）→ 回到全部列表可见
  await page.getByTestId('tab-recycle').click();
  await expect(row).toBeVisible();
  const restoreApi = expectApi('**/api/v1/projects/*/bugs/*/restore');
  await row.getByRole('button', { name: '恢复' }).click();
  const restored = await restoreApi;
  expect(restored.status).toBe(200);
  expect(restored.code).toBe(0);
  await expect(page.getByText('已恢复至原模块')).toBeVisible({ timeout: 8000 });
  await page.getByTestId('tab-all').click();
  await expect(row).toBeVisible();

  // 详情页：从「待处理」出发仅允许流转到「处理中」，不允许的目标（已关闭/待处理）无该流转按钮
  await row.getByRole('link', { name: bugTitle }).click();
  await expect(page.getByTestId('bug-status')).toHaveText('待处理');
  await expect(page.getByTestId('btn-transition-处理中')).toHaveCount(1);
  await expect(page.getByTestId('btn-transition-已关闭')).toHaveCount(0);
  await expect(page.getByTestId('btn-transition-待处理')).toHaveCount(0);

  await expectNoConsoleErrors();
});
