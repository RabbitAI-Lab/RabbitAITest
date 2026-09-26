import { test, expect, navFromHome } from "./fixtures";

/**
 * PROJ-002 模板与动态自定义字段（docs/sprint-1-mvp-test-mgmt/PROJ-002-template-custom-fields.md §5 T2/T3）：
 * - PROJ-002-01：字段（严重程度单选）→ 默认用例模板绑定（必填+列表显示）→ 用例缺省提交 422 → 补填成功 → 列表动态列
 * - PROJ-002-02：缺陷工作流加「挂起」态 + 矩阵勾选 → 详情页流转按钮组仅含允许项 → 合法流转成功
 * 页面实现：settings/templates/page.tsx、components/DynamicField.tsx、components/CaseForm.tsx、bugs/new|*.tsx。
 */

test("PROJ-002-01 字段→模板→用例联动（必填 422 + 列表列）", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
  expectApi,
}) => {
  void authedPage;
  const ts = Date.now();
  const fieldKey = `sev${ts}`; // 字段 key 规则 ^[a-z][a-z0-9_]{1,63}$（org 级，注册用户独占组织天然隔离）
  const fieldName = "严重程度";
  const caseName = `联动用例${ts}`;

  // 用户路径：首页 → 项目设置 › 模板管理（scene 默认=用例，字段 Tab 默认激活）
  await page.goto("/");
  await page.getByTestId("nav-settings-templates").click();
  await expect(page.getByTestId("btn-new-field")).toBeVisible();

  // ① 字段 Tab：新建「严重程度」单选字段（选项一行一个；必填留到模板绑定勾——验证模板级覆写）
  await page.getByTestId("btn-new-field").click();
  await page.getByTestId("input-field-name").fill(fieldName);
  await page.getByTestId("input-field-key").fill(fieldKey);
  await page.getByTestId("field-type-single_select").click();
  await page.getByTestId("input-field-options").fill("致命\n严重\n一般\n轻微");
  const fieldApi = expectApi("**/api/v1/orgs/*/field-defs");
  await page.getByTestId("btn-submit-field").click();
  const field = await fieldApi;
  expect(field.status).toBe(201);
  expect(field.code).toBe(0);
  // UI 断言：toast + 字段表出现该行
  await expect(page.getByText("字段已创建")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(fieldName) })).toBeVisible();

  // ② 模板 Tab：打开默认模板详情 → 绑定该字段并勾「必填 + 列表显示」覆写
  //（模板名是无 href 的 <a onClick>，无 link 角色——按 getByText 定位，templates/page.tsx 名称列）
  await page.getByTestId("tab-templates").click();
  await page.getByText("功能用例默认模板", { exact: true }).click();
  // 添加字段：下拉选中「严重程度（{key}）」
  await page.getByTestId("select-bind-field").click();
  await page.getByRole("option", { name: `${fieldName}（${fieldKey}）` }).click();
  // 绑定行内两个覆写复选框：第 1 个=必填（覆写），第 2 个=列表显示（覆写）（列序见 templates/page.tsx 绑定表）
  const bindRow = page.getByRole("row", { name: new RegExp(fieldName) });
  await expect(bindRow).toBeVisible();
  await bindRow.getByRole("checkbox").nth(0).check();
  await bindRow.getByRole("checkbox").nth(1).check();
  const bindApi = expectApi("**/api/v1/projects/*/templates/*/fields");
  await page.getByTestId("btn-save-bindings").click();
  const bound = await bindApi;
  expect(bound.status).toBe(200);
  expect(bound.code).toBe(0);
  await expect(page.getByText("模板已更新")).toBeVisible();

  // ③ 用例表单：不填严重程度提交 → 后端校验 422（code 20422）+ UI 透出服务端消息
  await navFromHome(page, "测试用例");
  await page.getByTestId("btn-new-case").click();
  await page.getByTestId("case-name").fill(caseName);
  // UI 断言：表单出现该动态字段控件（DynamicField.tsx dyn-{key}）
  await expect(page.getByTestId(`dyn-${fieldKey}`)).toBeVisible();
  const badApi = expectApi("**/api/v1/projects/*/cases");
  await page.getByTestId("btn-save-case").click();
  const bad = await badApi;
  expect(bad.status).toBe(422);
  expect(bad.code).toBe(20422);
  // UI 断言：后端校验消息就地透出（react-nextjs §5.7 禁通用文案）
  await expect(page.getByText(/自定义字段校验失败/)).toBeVisible();

  // ④ 选择「致命」→ 创建成功 → 列表出现严重程度列与取值
  await page.getByTestId(`dyn-${fieldKey}`).click();
  await page.getByRole("option", { name: "致命", exact: true }).click();
  const goodApi = expectApi("**/api/v1/projects/*/cases");
  await page.getByTestId("btn-save-case").click();
  const good = await goodApi;
  expect(good.status).toBe(201);
  expect(good.code).toBe(0);
  await expect(page).toHaveURL(/\/cases$/, { timeout: 8000 });
  // UI 断言：列表动态列（visibleInList 覆写生效）列头 + 单元格取值
  await expect(page.getByRole("columnheader", { name: fieldName })).toBeVisible();
  await expect(
    page.getByRole("row", { name: new RegExp(caseName) }).getByText("致命", { exact: true }),
  ).toBeVisible();

  await expectNoConsoleErrors([
    // 必填动态字段缺省提交：预期 422 被浏览器记为资源加载失败（§3.5.1 显式登记）
    {
      pageUrlPattern: "/cases/new",
      textPattern: "Failed to load resource.*422",
      reason: "必填自定义字段缺省提交预期 422",
    },
  ]);
});

test("PROJ-002-02 工作流矩阵与非法流转", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
  expectApi,
}) => {
  void authedPage;
  const bugTitle = `工作流缺陷${Date.now()}`;

  // 用户路径：首页 → 项目设置 › 模板管理 → 切缺陷场景 → 工作流 Tab
  await page.goto("/");
  await page.getByTestId("nav-settings-templates").click();
  await page.getByTestId("scene-bug").click();
  await page.getByTestId("tab-workflow").click();
  // UI 断言：预置工作流（待处理=初始 / 已关闭=结束）
  await expect(page.getByTestId("state-item-待处理")).toBeVisible();
  await expect(page.getByTestId("state-item-已关闭")).toBeVisible();

  // 新增「挂起」状态（Modal 输入状态名；接口断言 POST workflows/states）
  await page.getByTestId("btn-new-state").click();
  await page.getByRole("dialog").getByPlaceholder("状态名称（如：挂起）").fill("挂起");
  const stateApi = expectApi("**/api/v1/projects/*/workflows/states");
  // modal.confirm okText=确定（2 字主按钮渲染「确 定」），正则兼容
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /确\s*定/ })
    .click();
  const state = await stateApi;
  expect(state.status).toBe(201);
  expect(state.code).toBe(0);
  await expect(page.getByText("状态已创建")).toBeVisible();
  await expect(page.getByTestId("state-item-挂起")).toBeVisible();

  // 矩阵勾选 处理中→挂起 → 保存（接口断言 PUT workflows/transitions，预置 3 条 + 新增 1 条）
  await page.getByTestId("cell-处理中-挂起").check();
  const matrixApi = expectApi("**/api/v1/projects/*/workflows/transitions");
  await page.getByTestId("btn-save-transitions").click();
  const matrix = await matrixApi;
  expect(matrix.status).toBe(200);
  expect(matrix.code).toBe(0);
  expect((matrix.data as { count: number }).count).toBeGreaterThanOrEqual(4);
  await expect(page.getByText(/流转矩阵已保存/)).toBeVisible();

  // 用户路径：首页 → 测试管理 › 缺陷管理 → 新建缺陷（初始态=待处理）
  await navFromHome(page, "缺陷管理");
  await page.getByTestId("btn-new-bug").click();
  await page.getByTestId("input-bug-title").fill(bugTitle);
  const bugApi = expectApi("**/api/v1/projects/*/bugs");
  await page.getByTestId("btn-submit-bug").click();
  const bug = await bugApi;
  expect(bug.status).toBe(201);
  expect(bug.code).toBe(0);
  // 详情页状态徽标=待处理
  await expect(page.getByTestId("bug-status")).toHaveText("待处理");

  // UI 断言：流转按钮组只渲染白名单目标（allowedTransitions）——待处理仅可→处理中，「挂起」按钮不存在（非法目标不可点）
  await expect(page.getByTestId("btn-transition-处理中")).toBeVisible();
  await expect(page.getByTestId("btn-transition-挂起")).toHaveCount(0);

  // 合法流转 待处理→处理中：弹窗确认（okText=确认流转）→ 状态徽标变化 + 接口断言 transition 200
  await page.getByTestId("btn-transition-处理中").click();
  const transitionApi = expectApi("**/api/v1/projects/*/bugs/*/transition");
  await page.getByRole("dialog").getByRole("button", { name: "确认流转" }).click();
  const transitioned = await transitionApi;
  expect(transitioned.status).toBe(200);
  expect(transitioned.code).toBe(0);
  await expect(page.getByText("已流转为「处理中」")).toBeVisible();
  await expect(page.getByTestId("bug-status")).toHaveText("处理中");

  await expectNoConsoleErrors();
});

/** coverage-audit 回补：PROJ-002 §1.2 行 3「项目模板开关（启用后组织模板失效且不可逆，双确认弹窗）」整行无覆盖 +
 *  行 2 子能力（设默认 / 复制 / 系统默认模板预置不可删）。
 *  期望值溯源规格 §2/§3：启用校验=红色警示 Modal + 输入项目名确认；启用后组织模板对本项目不可见且不可逆。
 *  页面实现：settings/templates/page.tsx（btn-enable-project-template → input-enable-template-name → okText=确认启用；
 *  模板来源卡片 modeQ.enabled=false 时渲染；系统模板行不渲染删除按钮 templates/page.tsx:628）。 */
test("PROJ-002-03 项目模板开关不可逆与设默认/复制", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const pid = authedPage.projectId;
  const tplName = `项目模板${Date.now() % 100000}`;

  // 项目名（启用确认需输入项目名；注册创建的项目固定名「演示项目」，以接口断言口径取值）
  const infoRes = await request.get(`/api/v1/projects/${pid}/info`);
  expect(infoRes.status()).toBe(200);
  const projectName = ((await infoRes.json()) as { data: { name: string } }).data.name;

  // 用户路径：首页 → 项目设置 › 模板管理 → 模板 Tab（scene 默认=用例）
  await page.goto("/");
  await page.getByTestId("nav-settings-templates").click();
  await page.getByTestId("tab-templates").click();
  // UI 断言：模板来源=组织模板（继承）+ 启用入口 + 系统默认模板预置（含「系统」标记）
  await expect(page.getByText("模板来源：")).toBeVisible();
  await expect(page.getByText("组织模板对本项目生效")).toBeVisible();
  await expect(page.getByTestId("btn-enable-project-template")).toBeVisible();
  const systemRow = page.getByRole("row", { name: /功能用例默认模板/ });
  await expect(systemRow).toBeVisible();
  await expect(systemRow.getByText("系统", { exact: true })).toBeVisible();
  // 预置/自定义二态：系统模板行无删除按钮（不可删）
  await expect(systemRow.getByRole("button", { name: "删除" })).toHaveCount(0);

  // 新建模板（modal.confirm + 输入框 placeholder=模板名称；模板创建为组织级，启用前口径）
  await page.getByTestId("btn-new-template").click();
  await page.getByRole("dialog").getByPlaceholder("模板名称").fill(tplName);
  const createApi = expectApi("**/api/v1/projects/*/templates");
  await page.getByRole("dialog").getByRole("button", { name: /确\s*定/ }).click();
  const created = await createApi;
  expect(created.status).toBe(201);
  expect(created.code).toBe(0);
  await expect(page.getByText("模板已创建，可继续编辑字段绑定")).toBeVisible();
  const newRow = page.getByRole("row", { name: new RegExp(tplName) }).filter({
    hasNotText: "_copy",
  });
  await expect(newRow).toBeVisible();

  // 设为默认：默认标记迁移到新模板（每 scene 恰一默认，规格 §2）
  await newRow.getByRole("button", { name: "设为默认" }).click();
  await expect(page.getByText("已设为默认模板")).toBeVisible();
  await expect(newRow.getByText("默认", { exact: true })).toBeVisible();
  await expect(systemRow.getByText("默认", { exact: true })).toHaveCount(0);

  // 复制：名称 _copy 后缀（template.service.ts copyTemplate）
  const copyApi = expectApi("**/api/v1/projects/*/templates/*/copy");
  await newRow.getByRole("button", { name: "复制" }).click();
  const copied = await copyApi;
  expect(copied.status).toBe(200);
  expect(copied.code).toBe(0);
  await expect(page.getByText("模板已复制")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(`${tplName}_copy`) })).toBeVisible();

  // 启用项目模板（不可逆）：双确认——错误项目名时确认按钮禁用，正确后可点
  await page.getByTestId("btn-enable-project-template").click();
  const enableDialog = page.getByRole("dialog");
  await expect(enableDialog.getByText("该操作不可逆")).toBeVisible();
  await enableDialog.getByTestId("input-enable-template-name").fill("错误的项目名");
  await expect(enableDialog.getByRole("button", { name: "确认启用" })).toBeDisabled();
  await enableDialog.getByTestId("input-enable-template-name").fill(projectName);
  await expect(enableDialog.getByRole("button", { name: "确认启用" })).toBeEnabled();
  const enableApi = expectApi("**/api/v1/projects/*/template-mode/enable");
  await enableDialog.getByRole("button", { name: "确认启用" }).click();
  const enabled = await enableApi;
  expect(enabled.status).toBe(200);
  expect(enabled.code).toBe(0);
  await expect(page.getByText("已启用项目模板（组织模板对本项目永久失效）")).toBeVisible();
  // UI 断言：组织模板对本项目失效（列表不含组织默认模板与 _copy 组织副本）+ 启用入口消失（不可逆）
  await expect(systemRow).toHaveCount(0);
  await expect(page.getByRole("row", { name: new RegExp(`${tplName}_copy`) })).toHaveCount(0);
  await expect(page.getByText("组织模板对本项目生效")).toHaveCount(0);
  await expect(page.getByTestId("btn-enable-project-template")).toHaveCount(0);
  // 启用后项目级模板可用（新建落到项目模板集）
  await page.getByTestId("btn-new-template").click();
  await page.getByRole("dialog").getByPlaceholder("模板名称").fill(`${tplName}-P`);
  const createPApi = expectApi("**/api/v1/projects/*/templates");
  await page.getByRole("dialog").getByRole("button", { name: /确\s*定/ }).click();
  const createdP = await createPApi;
  expect(createdP.status).toBe(201);
  await expect(page.getByRole("row", { name: new RegExp(`${tplName}-P`) })).toBeVisible();

  await expectNoConsoleErrors();
});
