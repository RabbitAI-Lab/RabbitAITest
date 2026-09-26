import type { APIRequestContext, Locator } from "@playwright/test";
import { test, expect, navFromHome } from "./fixtures";

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
  request: APIRequestContext,
  projectId: string,
  name: string,
  parentId?: string,
): Promise<string> {
  const res = await request.post(`/api/v1/projects/${projectId}/modules?scene=case`, {
    data: { name, ...(parentId ? { parentId } : {}) },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { code: number; data: { id: string } };
  expect(body.code).toBe(0);
  return body.data.id;
}

test("CASE-002-01 模块树过滤与含子级", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const uniq = `${Date.now() % 100000}`;
  const rootName = `父模块${uniq}`;
  const childName = `子模块${uniq}`;
  const caseName = `含子级过滤用例${uniq}`;
  const pid = authedPage.projectId;

  // 用户路径：首页 → 左侧菜单「测试用例」（rules/testing §3.2.2）
  await navFromHome(page, "测试用例");
  await expect(page.getByTestId("module-panel-case")).toBeVisible();

  // 工具栏「+」创建根模块（ModuleTreePanel.promptCreate：modal.confirm + 「模块名称」输入）
  await page.getByTestId("module-add-root").click();
  await page.getByPlaceholder("模块名称").fill(rootName);
  const moduleApi = expectApi("**/api/v1/projects/*/modules?scene=case");
  // antd zh_CN：2 个汉字的主按钮自动插入空格（「确 定」），正则兼容（与 BUG-001-02 同款写法）
  await page.getByRole("button", { name: /^(确\s*定|OK)$/ }).click();
  const mod = await moduleApi;
  expect(mod.status).toBe(201);
  expect(mod.code).toBe(0);
  const rootId = (mod.data as { id: string }).id;
  // UI 断言：toast + 树节点出现
  await expect(page.getByText("模块已创建")).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId(`module-node-${rootName}`)).toBeVisible();

  // API 造子模块 + 挂子模块的用例（request 复用 authedPage 注册会话 cookie）
  const childId = await apiCreateModule(request, pid, childName, rootId);
  const caseRes = await request.post(`/api/v1/projects/${pid}/cases`, {
    data: {
      name: caseName,
      precondition: "",
      steps: [],
      level: "P2",
      tags: [],
      fields: {},
      moduleId: childId,
    },
  });
  expect(caseRes.status()).toBe(201);
  const caseBody = (await caseRes.json()) as { code: number; data: { id: string; num: number } };
  expect(caseBody.code).toBe(0);

  // API 造数后重新经首页导航进入（模块树/列表全新拉取；录屏保留完整入口路径）
  await navFromHome(page, "测试用例");
  await expect(page.getByTestId("module-panel-case")).toBeVisible();
  await expect(page.getByTestId(`module-node-${rootName}`)).toBeVisible();
  // defaultExpandAll 仅作用于初始渲染（首帧树为空）：数据到达后根节点需手动展开其 switcher 才能见子级
  //（与 MAINFLOW-s1 同款兜底；已在展开态则跳过）
  const childNode = page.getByTestId(`module-node-${childName}`);
  if (!(await childNode.isVisible())) {
    await page
      .locator(".ant-tree-treenode")
      .filter({ has: page.getByTestId(`module-node-${rootName}`) })
      .locator(".ant-tree-switcher")
      .first()
      .click();
  }
  await expect(childNode).toBeVisible();

  // 取消「含子级」（moduleId 未选，此时不发请求）→ 点父模块：仅本模块用例（0 条）
  await page.getByTestId("include-children").click(); // 初始勾选态，点击一次取消
  const noChildApi = expectApi("**/api/v1/projects/*/cases?*includeChildren=false*");
  await page.getByTestId(`module-node-${rootName}`).click();
  const noChild = await noChildApi;
  // 接口断言：URL 参数 includeChildren=false + 响应体 total=0
  expect(noChild.status).toBe(200);
  expect(noChild.code).toBe(0);
  expect((noChild.data as { total: number }).total).toBe(0);
  // UI 断言：模块空态文案 + 用例行消失
  await expect(page.getByText("该模块暂无用例，去新建或导入")).toBeVisible();
  await expect(page.getByText(caseName)).toHaveCount(0);

  // 勾选「含子级」：父模块过滤命中子模块用例（1 条）
  const withChildApi = expectApi("**/api/v1/projects/*/cases?*includeChildren=true*");
  await page.getByTestId("include-children").click();
  const withChild = await withChildApi;
  // 接口断言：URL 参数 includeChildren=true + total=1
  expect(withChild.status).toBe(200);
  expect(withChild.code).toBe(0);
  expect((withChild.data as { total: number }).total).toBe(1);
  // UI 断言：用例行出现 + 分页总数
  await expect(page.getByText(caseName)).toBeVisible();
  await expect(page.getByText("共 1 条")).toBeVisible();

  await expectNoConsoleErrors();
});

test("CASE-002-02 视图保存与切换", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
  expectApi,
}) => {
  void authedPage;
  const viewName = `P1视图${Date.now() % 100000}`;

  // 用户路径：首页 → 左侧菜单「测试用例」
  await navFromHome(page, "测试用例");
  await expect(page.getByTestId("case-table")).toBeVisible();

  // 展开高级筛选 → 等级 P1（cases/page.tsx：btn-advanced-filter + select-level）
  await page.getByTestId("btn-advanced-filter").click();
  await expect(page.getByTestId("advanced-filter-panel")).toBeVisible();
  await page.getByTestId("select-level").click();
  await page.getByRole("option", { name: "等级 P1" }).click();
  await expect(page.getByTestId("select-level")).toContainText("P1");

  // 另存为视图（viewApi.create → POST /views）
  await page.getByTestId("btn-save-view").click();
  await page.getByTestId("input-view-name").fill(viewName);
  const saveApi = expectApi("**/api/v1/projects/*/views");
  await page.getByRole("button", { name: /保\s*存/ }).click();
  const saved = await saveApi;
  // 接口断言：POST /views 201 + code=0（视图实体含 id）
  expect(saved.status).toBe(201);
  expect(saved.code).toBe(0);
  const viewId = (saved.data as { id: string }).id;
  // UI 断言：toast + 自定义视图 Tab 出现（testid=view-{id}）
  await expect(page.getByText("视图已保存")).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId(`view-${viewId}`)).toBeVisible();
  await expect(page.getByTestId(`view-${viewId}`)).toHaveText(viewName);

  // 刷新后切换视图 → 筛选还原（等级下拉回显 P1）+ 列表按 viewId 查询
  await page.reload();
  await expect(page.getByTestId("case-table")).toBeVisible();
  await expect(page.getByTestId(`view-${viewId}`)).toBeVisible();
  const viewQueryApi = expectApi("**/api/v1/projects/*/cases?*viewId=*");
  await page.getByTestId(`view-${viewId}`).click();
  const byView = await viewQueryApi;
  // 接口断言：视图 Tab 查询带 viewId 参数
  expect(byView.status).toBe(200);
  expect(byView.code).toBe(0);
  await page.getByTestId("btn-advanced-filter").click();
  await expect(page.getByTestId("advanced-filter-panel")).toBeVisible();
  await expect(page.getByTestId("select-level")).toContainText("等级 P1");

  // 删除视图（Tab 旁 X → modal.confirm）→ 回退「全部」
  await page.getByTitle("删除该视图").click();
  // antd confirm 弹窗内含隐藏 .ant-modal-title（aria 用）与可见 confirm-title 两份 → 按弹窗作用域断言
  await expect(page.getByRole("dialog").filter({ hasText: /删除视图/ })).toBeVisible();
  const delApi = expectApi("**/api/v1/projects/*/views/*");
  await page.getByRole("button", { name: /^(确\s*定|OK)$/ }).click();
  const deleted = await delApi;
  // 接口断言：DELETE /views/{id} 200 + code=0
  expect(deleted.status).toBe(200);
  expect(deleted.code).toBe(0);
  // UI 断言：回退提示 + 视图 Tab 消失 + 「全部」Tab 可见
  await expect(page.getByText("视图已删除，已回退「全部」")).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId(`view-${viewId}`)).toHaveCount(0);
  await expect(page.getByTestId("view-tab-all")).toBeVisible();

  await expectNoConsoleErrors();
});

/** coverage-audit 回补：CASE-002 §1.2 行 5「批量操作：移动到模块、批量编辑（等级/标签/执行人）」——规格 §5 T4 声明
 *  「批量移动 3 条→toast 成功→各目标模块计数 +N」从未落地；行 1「节点用例计数（含子树）」与「默认模块不可删名可改」
 *  （预置/自定义二态）一并覆盖；行 4「分享（复制链接含模块与筛选参数）」列表行入口。
 *  页面实现：cases/page.tsx（batch-bar / btn-batch-move / select-move-target / btn-batch-edit / select-batch-level /
 *  btn-share-{num} → navigator.clipboard）；ModuleTreePanel.tsx（右键菜单=新建子模块/重命名/删除；节点计数 subtreeCount）。 */
test("CASE-002-03 批量移动与模块计数、批量编辑、行分享、默认模块改名", async ({
  authedPage,
  page,
  request,
  context,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const uniq = `${Date.now() % 100000}`;
  const targetName = `移动目标${uniq}`;
  const pid = authedPage.projectId;

  // API 造模块 + 2 条用例（挂默认模块；authedPage 项目隔离）
  const modRes = await request.post(`/api/v1/projects/${pid}/modules?scene=case`, {
    data: { name: targetName },
  });
  expect(modRes.status()).toBe(201);
  const modId = ((await modRes.json()) as { data: { id: string } }).data.id;
  const caseIds: string[] = [];
  const caseNums: number[] = [];
  for (const name of [`批量甲${uniq}`, `批量乙${uniq}`]) {
    const r = await request.post(`/api/v1/projects/${pid}/cases`, {
      data: { name, precondition: "", steps: [], level: "P2", tags: [], fields: {} },
    });
    expect(r.status()).toBe(201);
    const b = (await r.json()) as { code: number; data: { id: string; num: number } };
    expect(b.code).toBe(0);
    caseIds.push(b.data.id);
    caseNums.push(b.data.num);
  }

  // 用户路径：首页 → 测试用例；勾选 2 条 → 批量条浮现
  await navFromHome(page, "测试用例");
  await expect(page.getByTestId("case-table")).toBeVisible();
  for (const name of [`批量甲${uniq}`, `批量乙${uniq}`]) {
    await page
      .getByRole("row", { name: new RegExp(name) })
      .locator('input[type="checkbox"]')
      .check();
  }
  await expect(page.getByTestId("batch-bar")).toBeVisible();
  await expect(page.getByTestId("batch-bar")).toContainText("已选 2 项");

  // 批量移动：弹窗选目标模块（TreeSelect）→ 移动（接口断言 batch-move payload：ids + moduleId）
  await page.getByTestId("btn-batch-move").click();
  await page.getByTestId("select-move-target").click();
  // 限定 TreeSelect 弹层树（与左侧 ModuleTreePanel 同名 treeitem 严格模式冲突）
  await page.locator(".ant-select-tree-list-holder, .ant-tree").filter({ hasText: targetName }).last().getByRole("treeitem", { name: new RegExp(targetName) }).first().click();
  const moveApi = expectApi("**/api/v1/projects/*/cases/batch-move");
  const moveRaw = page.waitForResponse("**/api/v1/projects/*/cases/batch-move");
  await page.getByRole("dialog").getByRole("button", { name: /移\s*动/ }).click();
  const moved = await moveApi;
  expect(moved.status).toBe(200);
  expect(moved.code).toBe(0);
  expect((moved.data as { affected: number }).affected).toBe(2);
  const moveRawRes = await moveRaw;
  expect(moveRawRes.request().postDataJSON()).toMatchObject({
    ids: expect.arrayContaining(caseIds),
    moduleId: modId,
  });
  await expect(page.getByText("已移动 2 条")).toBeVisible();

  // UI 断言：目标模块节点计数（含子树）= 2（ModuleTreePanel subtreeCount）
  await expect(page.getByTestId(`module-node-${targetName}`)).toHaveText(
    new RegExp(`${targetName}\\s*2`),
  );
  // 点目标模块过滤 → 列表 2 条（共 2 条）
  const targetNode = page.getByTestId(`module-node-${targetName}`);
  await targetNode.scrollIntoViewIfNeeded();
  await targetNode.click({ timeout: 15_000 }).catch(async () => {
    // 树计数刷新期重渲染抖动兜底：等稳定后强点击（真实事件派发，选择逻辑不受影响）
    await page.waitForTimeout(800);
    await targetNode.click({ force: true });
  });
  await expect(page.getByText("共 2 条", { exact: true })).toBeVisible({ timeout: 8000 });

  // 行分享：复制链接含模块参数（cases/page.tsx shareRow → /cases?moduleId={id}）
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByTestId(`btn-share-${caseNums[0]}`).click();
  await expect(page.getByText("链接已复制")).toBeVisible();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  expect(shared).toContain(`/cases?moduleId=${modId}`);

  // 批量编辑：重新勾选 2 条（仍在目标模块过滤视图内）→ 等级改 P1 → 应用（接口断言 batch-update payload）
  await expect(page.getByTestId("case-table")).toBeVisible();
  for (const name of [`批量甲${uniq}`, `批量乙${uniq}`]) {
    await page
      .getByRole("row", { name: new RegExp(name) })
      .locator('input[type="checkbox"]')
      .check();
  }
  await page.getByTestId("btn-batch-edit").click();
  await page.getByTestId("select-batch-level").click();
  await page.getByRole("option", { name: "P1", exact: true }).click();
  const updateApi = expectApi("**/api/v1/projects/*/cases/batch-update");
  await page.getByRole("dialog").getByRole("button", { name: /应\s*用/ }).click();
  const updated = await updateApi;
  expect(updated.status).toBe(200);
  expect(updated.code).toBe(0);
  expect((updated.data as { affected: number }).affected).toBe(2);
  await expect(page.getByText("已更新 2 条")).toBeVisible();
  // UI 断言：行内等级列变 P1
  await expect(
    page.getByRole("row", { name: new RegExp(`批量甲${uniq}`) }).getByText("P1", { exact: true }),
  ).toBeVisible();

  // 默认模块「未规划用例」：右键改名可用（规格 §1.2 行 1：默认模块不可删、名可改——预置/自定义二态）
  const defaultNode = page.getByTestId("module-node-未规划用例");
  const clickNodeStable = async (loc: ReturnType<Page['getByTestId']>) => {
    await loc.scrollIntoViewIfNeeded();
    await loc.click({ timeout: 15_000 }).catch(async () => {
      await page.waitForTimeout(800);
      await loc.click({ force: true });
    });
  };
  await clickNodeStable(defaultNode).catch(() => {});
  await defaultNode.click({ button: "right" });
  await page.getByRole("menuitem", { name: "重命名" }).click();
  const renamed = `未规划改名${uniq}`;
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("模块名称").fill(renamed);
  const renameApi = expectApi("**/api/v1/projects/*/modules/*");
  await dialog.getByRole("button", { name: /^(确\s*定|OK)$/ }).click();
  const renameRes = await renameApi;
  expect(renameRes.status).toBe(200);
  expect(renameRes.code).toBe(0);
  await expect(page.getByText("已重命名")).toBeVisible();
  await expect(page.getByTestId(`module-node-${renamed}`)).toBeVisible();
  await expect(page.getByTestId("module-node-未规划用例")).toHaveCount(0);

  await expectNoConsoleErrors();
});
