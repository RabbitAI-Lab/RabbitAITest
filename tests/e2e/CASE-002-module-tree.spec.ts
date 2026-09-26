import type { APIRequestContext } from '@playwright/test';
import { test, expect, navFromHome } from './fixtures';

/**
 * 规格：docs/sprint-1-mvp-test-mgmt/CASE-002-module-tree-list.md §5（T2 模块过滤+含子级开关、T3 自定义视图）
 * 选择器来源（已核对源码，勿凭原型臆造）：
 * - apps/web/src/app/(console)/cases/page.tsx：btn-advanced-filter / advanced-filter-panel / select-level /
 *   btn-save-view / input-view-name / view-tab-all / view-{id}（自定义视图 Tab testid 为 `view-${v.id}`）、
 *   删除视图入口 = span[title="删除该视图"]；列表请求由 listQuery 组装（includeChildren=true|false 落在 URL）
 * - apps/web/src/components/ModuleTreePanel.tsx：module-add-root（工具栏 + 按钮）→ modal.confirm + Input
 *   placeholder「模块名称」；module-node-{name}（titleRender 内层 div）；include-children（底部 label 含 checkbox）
 * - 子模块经右键 contextMenu 创建在自动化中不稳定（Dropdown trigger=contextMenu），按 CASE-002 §5 T2 精度
 *   采用 API 直造（POST /api/v1/projects/{pid}/modules?scene=case body {name,parentId}，moduleUpsertSchema）
 * 数据隔离：authedPage 每用例独立注册用户 + 项目（fixtures.ts）；模块/用例均造于该项目。
 */

/** API 造模块（moduleUpsertSchema：{ name, parentId? }；POST …/modules?scene=case → 201） */
async function apiCreateModule(
  request: APIRequestContext, projectId: string, name: string, parentId?: string,
): Promise<string> {
  const res = await request.post(`/api/v1/projects/${projectId}/modules?scene=case`, {
    data: { name, ...(parentId ? { parentId } : {}) },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { code: number; data: { id: string } };
  expect(body.code).toBe(0);
  return body.data.id;
}

test('CASE-002-01 模块树过滤与含子级', async ({ authedPage, page, request, expectNoConsoleErrors, expectApi }) => {
  const uniq = `${Date.now() % 100000}`;
  const rootName = `父模块${uniq}`;
  const childName = `子模块${uniq}`;
  const caseName = `含子级过滤用例${uniq}`;
  const pid = authedPage.projectId;

  // 用户路径：首页 → 左侧菜单「测试用例」（rules/testing §3.2.2）
  await navFromHome(page, '测试用例');
  await expect(page.getByTestId('module-panel-case')).toBeVisible();

  // 工具栏「+」创建根模块（ModuleTreePanel.promptCreate：modal.confirm + 「模块名称」输入）
  await page.getByTestId('module-add-root').click();
  await page.getByPlaceholder('模块名称').fill(rootName);
  const moduleApi = expectApi('**/api/v1/projects/*/modules?scene=case');
  await page.getByRole('button', { name: /^(确定|OK)$/ }).click();
  const mod = await moduleApi;
  expect(mod.status).toBe(201);
  expect(mod.code).toBe(0);
  const rootId = (mod.data as { id: string }).id;
  // UI 断言：toast + 树节点出现
  await expect(page.getByText('模块已创建')).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId(`module-node-${rootName}`)).toBeVisible();

  // API 造子模块 + 挂子模块的用例（request 复用 authedPage 注册会话 cookie）
  const childId = await apiCreateModule(request, pid, childName, rootId);
  const caseRes = await request.post(`/api/v1/projects/${pid}/cases`, {
    data: { name: caseName, precondition: '', steps: [], level: 'P2', tags: [], fields: {}, moduleId: childId },
  });
  expect(caseRes.status()).toBe(201);
  const caseBody = (await caseRes.json()) as { code: number; data: { id: string; num: number } };
  expect(caseBody.code).toBe(0);

  // API 造数后重新经首页导航进入（模块树/列表全新拉取；录屏保留完整入口路径）
  await navFromHome(page, '测试用例');
  await expect(page.getByTestId('module-panel-case')).toBeVisible();
  await expect(page.getByTestId(`module-node-${rootName}`)).toBeVisible();
  await expect(page.getByTestId(`module-node-${childName}`)).toBeVisible();

  // 取消「含子级」（moduleId 未选，此时不发请求）→ 点父模块：仅本模块用例（0 条）
  await page.getByTestId('include-children').click(); // 初始勾选态，点击一次取消
  const noChildApi = expectApi('**/api/v1/projects/*/cases?*includeChildren=false*');
  await page.getByTestId(`module-node-${rootName}`).click();
  const noChild = await noChildApi;
  // 接口断言：URL 参数 includeChildren=false + 响应体 total=0
  expect(noChild.status).toBe(200);
  expect(noChild.code).toBe(0);
  expect((noChild.data as { total: number }).total).toBe(0);
  // UI 断言：模块空态文案 + 用例行消失
  await expect(page.getByText('该模块暂无用例，去新建或导入')).toBeVisible();
  await expect(page.getByText(caseName)).toHaveCount(0);

  // 勾选「含子级」：父模块过滤命中子模块用例（1 条）
  const withChildApi = expectApi('**/api/v1/projects/*/cases?*includeChildren=true*');
  await page.getByTestId('include-children').click();
  const withChild = await withChildApi;
  // 接口断言：URL 参数 includeChildren=true + total=1
  expect(withChild.status).toBe(200);
  expect(withChild.code).toBe(0);
  expect((withChild.data as { total: number }).total).toBe(1);
  // UI 断言：用例行出现 + 分页总数
  await expect(page.getByText(caseName)).toBeVisible();
  await expect(page.getByText('共 1 条')).toBeVisible();

  await expectNoConsoleErrors();
});

test('CASE-002-02 视图保存与切换', async ({ authedPage, page, expectNoConsoleErrors, expectApi }) => {
  void authedPage;
  const viewName = `P1视图${Date.now() % 100000}`;

  // 用户路径：首页 → 左侧菜单「测试用例」
  await navFromHome(page, '测试用例');
  await expect(page.getByTestId('case-table')).toBeVisible();

  // 展开高级筛选 → 等级 P1（cases/page.tsx：btn-advanced-filter + select-level）
  await page.getByTestId('btn-advanced-filter').click();
  await expect(page.getByTestId('advanced-filter-panel')).toBeVisible();
  await page.getByTestId('select-level').click();
  await page.getByRole('option', { name: '等级 P1' }).click();
  await expect(page.getByTestId('select-level')).toContainText('P1');

  // 另存为视图（viewApi.create → POST /views）
  await page.getByTestId('btn-save-view').click();
  await page.getByTestId('input-view-name').fill(viewName);
  const saveApi = expectApi('**/api/v1/projects/*/views');
  await page.getByRole('button', { name: '保存' }).click();
  const saved = await saveApi;
  // 接口断言：POST /views 201 + code=0（视图实体含 id）
  expect(saved.status).toBe(201);
  expect(saved.code).toBe(0);
  const viewId = (saved.data as { id: string }).id;
  // UI 断言：toast + 自定义视图 Tab 出现（testid=view-{id}）
  await expect(page.getByText('视图已保存')).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId(`view-${viewId}`)).toBeVisible();
  await expect(page.getByTestId(`view-${viewId}`)).toHaveText(viewName);

  // 刷新后切换视图 → 筛选还原（等级下拉回显 P1）+ 列表按 viewId 查询
  await page.reload();
  await expect(page.getByTestId('case-table')).toBeVisible();
  await expect(page.getByTestId(`view-${viewId}`)).toBeVisible();
  const viewQueryApi = expectApi('**/api/v1/projects/*/cases?*viewId=*');
  await page.getByTestId(`view-${viewId}`).click();
  const byView = await viewQueryApi;
  // 接口断言：视图 Tab 查询带 viewId 参数
  expect(byView.status).toBe(200);
  expect(byView.code).toBe(0);
  await page.getByTestId('btn-advanced-filter').click();
  await expect(page.getByTestId('advanced-filter-panel')).toBeVisible();
  await expect(page.getByTestId('select-level')).toContainText('等级 P1');

  // 删除视图（Tab 旁 X → modal.confirm）→ 回退「全部」
  await page.getByTitle('删除该视图').click();
  await expect(page.getByText('删除视图')).toBeVisible();
  const delApi = expectApi('**/api/v1/projects/*/views/*');
  await page.getByRole('button', { name: /^(确定|OK)$/ }).click();
  const deleted = await delApi;
  // 接口断言：DELETE /views/{id} 200 + code=0
  expect(deleted.status).toBe(200);
  expect(deleted.code).toBe(0);
  // UI 断言：回退提示 + 视图 Tab 消失 + 「全部」Tab 可见
  await expect(page.getByText('视图已删除，已回退「全部」')).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId(`view-${viewId}`)).toHaveCount(0);
  await expect(page.getByTestId('view-tab-all')).toBeVisible();

  await expectNoConsoleErrors();
});
