import { test, expect, navClick, enterRealm } from "./fixtures";

/**
 * PROJ-001 项目成员、项目级权限与项目生命周期（docs/sprint-1-mvp-test-mgmt/PROJ-001-project-permission.md §5 T2/T3）：
 * - PROJ-001-01：模块开关（关闭缺陷→菜单隐藏→恢复）+ 组织项目删除→已删除页签→撤销恢复
 * - PROJ-001-02：成员管理（注册创建者在成员表内）
 * 页面实现：settings/info/page.tsx、org/projects/page.tsx、settings/members/page.tsx、LeftNav.tsx。
 */

test("PROJ-001-01 模块开关与删除撤销", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
  expectApi,
}) => {
  void authedPage;
  const ts = Date.now();
  const projectName = `E2E撤销项目${ts}`;

  // 用户路径：首页 → 项目设置 › 基本信息
  await page.goto("/");
  await navClick(page, "nav-settings-info");
  await expect(page.getByTestId("project-info-form")).toBeVisible();
  await expect(page.getByTestId("module-switch-bug")).toBeVisible();

  // 关闭「缺陷管理」开关 → 保存（接口断言 PUT /api/v1/projects/{pid}）
  await page.getByTestId("module-switch-bug").click();
  // UI 断言：开关旁出现「已关闭」提示
  await expect(page.getByText("已关闭：菜单隐藏，数据保留，可随时开启")).toBeVisible();
  const saveOffApi = expectApi("**/api/v1/projects/*");
  await page.getByTestId("btn-save-info").click();
  const savedOff = await saveOffApi;
  expect(savedOff.status).toBe(200);
  expect(savedOff.code).toBe(0);
  await expect(page.getByText("基本信息已保存")).toBeVisible();
  // UI 断言：左侧导航缺陷入口隐藏。
  // 注：读 middleware.ts 确认 matcher 不含 /bugs、bugs 页面无模块守卫——直访不重定向，故以「菜单隐藏」为断言口径（PROJ-001 §2 的 UI 收敛语义）
  await expect(page.getByTestId("nav-bugs")).toHaveCount(0);

  // 回设置重新开启 → 保存 → 菜单恢复（接口断言第二次 PUT）
  await page.getByTestId("module-switch-bug").click();
  const saveOnApi = expectApi("**/api/v1/projects/*");
  await page.getByTestId("btn-save-info").click();
  const savedOn = await saveOnApi;
  expect(savedOn.status).toBe(200);
  expect(savedOn.code).toBe(0);
  await expect(page.getByTestId("nav-bugs")).toBeVisible();

  // 用户路径：左导航 → 组织 › 项目管理（nav-org-projects）
  await enterRealm(page, "org");
  await navClick(page, "nav-org-projects");
  await expect(page.getByRole("row", { name: /演示项目/ })).toBeVisible();

  // 新建项目（接口断言 POST /api/v1/orgs/{org}/projects）
  await page.getByTestId("btn-new-project").click();
  await page.getByTestId("input-new-project-name").fill(projectName);
  const createApi = expectApi("**/api/v1/orgs/*/projects");
  // Modal okText=创建（2 字主按钮渲染「创 建」），正则兼容
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /创\s*建/ })
    .click();
  const created = await createApi;
  expect(created.status).toBe(201);
  expect(created.code).toBe(0);
  await expect(page.getByText("项目已创建")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(projectName) })).toBeVisible();

  // 删除：行内删除 → Modal 二次确认（明示 30 天可撤销）→ 确认（接口断言 DELETE /api/v1/projects/{pid}）
  await page
    .getByRole("row", { name: new RegExp(projectName) })
    .getByTestId("btn-delete-project")
    .click();
  await expect(page.getByText(/30 天内可在「已删除」页签撤销恢复/)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "确认删除" }).click();
  // 删除完成信号=toast+列表行消失（expectApi 高压竞态漏窗口教训——收口 UI 断言；DELETE 负载断言归 jmx 层）
  await expect(page.getByText(/项目已删除/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("row", { name: new RegExp(projectName) })).toHaveCount(0);

  // 「已删除」页签出现该项目 → 撤销恢复（接口断言 POST restore）→ 回「项目列表」页签
  await page.getByTestId("tab-deleted").click();
  await expect(page.getByRole("row", { name: new RegExp(projectName) })).toBeVisible();
  const restoreApi = expectApi("**/api/v1/projects/*/restore");
  await page
    .getByRole("row", { name: new RegExp(projectName) })
    .getByTestId("btn-restore-project")
    .click();
  const restored = await restoreApi;
  expect(restored.status).toBe(200);
  expect(restored.code).toBe(0);
  await expect(page.getByText("项目已恢复")).toBeVisible();
  await page.getByTestId("tab-list").click();
  await expect(page.getByRole("row", { name: new RegExp(projectName) })).toBeVisible();

  await expectNoConsoleErrors();
});

test("PROJ-001-02 成员管理：注册创建者即项目成员", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
  expectApi,
}) => {
  // 用户路径：首页 → 项目设置 › 成员管理（nav-settings-members；先挂接口监听再导航，捕获首屏列表请求）
  await page.goto("/");
  const membersApi = expectApi("**/api/v1/projects/*/members*");
  await navClick(page, "nav-settings-members");

  // 接口断言：成员分页信封 code=0 且包含本人
  const members = await membersApi;
  expect(members.status).toBe(200);
  expect(members.code).toBe(0);
  const data = members.data as { total: number; items: { email: string }[] };
  expect(data.total).toBeGreaterThanOrEqual(1);
  expect(data.items.some((m) => m.email === authedPage.email)).toBe(true);

  // UI 断言：成员表（member-email）含创建者本人邮箱
  await expect(
    page.getByTestId("member-email").filter({ hasText: authedPage.email }),
  ).toBeVisible();

  await expectNoConsoleErrors();
});

/** P-2 回归（coverage-audit §10）：组织管理员拉系统用户进组织 → 项目成员添加（基线三级链路打通）。 */
test("PROJ-001-03 组织成员加入 → 项目成员添加（P-2）", async ({ authedPage, request, page }) => {
  const { projectId } = authedPage;
  // 候选用户：另注册一个（自建组织），对本组织是"系统用户"
  const email = `p2-org-${Date.now() % 100000}@rabbit.test`;
  // 隔离上下文注册（同 fixture 注册会覆写 ras 会话，劫持后续请求的身份）
  const { request: pwRequest } = await import("@playwright/test");
  const iso = await pwRequest.newContext();
  const reg = await iso.post("/api/v1/auth/register", {
    data: { email, password: process.env.E2E_USER_PASSWORD ?? "rabbit-pass-123" },
  });
  expect(reg.status()).toBe(201);
  const uid = ((await reg.json()) as { data: { userId: string } }).data.userId;
  await iso.dispose();
  const info = await request.get(`/api/v1/projects/${projectId}/info`);
  const orgId = ((await info.json()) as { data: { org: { id: string } } }).data.org.id;

  // 未加入组织前：项目成员添加应被拒（仅可添加组织成员）
  const pre = await request.post(`/api/v1/projects/${projectId}/members`, {
    data: { userIds: [uid] },
  });
  expect(pre.status()).toBe(422);

  // 用户路径：组织 › 成员管理 → 搜索添加
  await page.goto("/");
  await enterRealm(page, "org");
  await navClick(page, "nav-org-members");
  await page.getByTestId("org-member-candidate-select").click();
  await page.keyboard.type(email.split("@")[0]);
  await page.locator(`.ant-select-item-option[title*="${email}"]`).first().click();
  const addApi = page.waitForResponse(
    (r) => r.url().includes("/members-add") && r.request().method() === "POST",
  );
  await page.getByTestId("btn-add-org-member").click();
  const added = await addApi;
  expect(added.status()).toBe(201);
  await expect(page.getByTestId(`org-member-${email}`)).toBeVisible();

  // 组织成员进项目：设置 › 成员管理 添加成功（此前 422 → 现 200）
  const post = await request.post(`/api/v1/projects/${projectId}/members`, {
    data: { userIds: [uid] },
  });
  expect(post.status()).toBe(201);
  const members = await request.get(`/api/v1/projects/${projectId}/members`);
  const list = ((await members.json()) as { data: { items: { email: string }[] } }).data.items;
  expect(list.some((m) => m.email === email)).toBe(true);
});

/**
 * PROJ-001-04 基本信息：加载失败可感知、可重试（2026-09-30 线上报障回归）。
 * 病理：dev 栈重启/网络闪断时 /info 查询失败，页面把「错误」也渲染成 Spin——无限转圈无提示。
 * 口径：拦截 /info 回 500 信封 → 断言错误态（含服务端 message）替代 Spin → 放行后点「重试」恢复表单。
 * Console 白名单：模拟 500 必然产生 [http 500] 留痕（fixtures §4xx/5xx 一并记录），显式登记。
 */
test("PROJ-001-04 基本信息：加载失败错误态与重试恢复", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
}) => {
  void authedPage;
  const failBody = JSON.stringify({ code: 50000, message: "E2E模拟服务重启" });
  await page.route("**/api/v1/projects/*/info", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: failBody }),
  );

  // 用户路径：首页（建立项目上下文）→ 项目设置 › 基本信息
  await page.goto("/");
  await navClick(page, "nav-settings-info");

  // UI 断言：错误态替代无限 Spin，透出服务端 message
  await expect(page.getByTestId("project-info-error")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("E2E模拟服务重启")).toBeVisible();
  // 旧缺陷口径：表单不应出现（否则说明错误态没接管）
  await expect(page.getByTestId("input-project-name")).toHaveCount(0);

  // 恢复：放行真实接口 → 重试 → 表单可见
  await page.unroute("**/api/v1/projects/*/info");
  await page.getByTestId("btn-retry-info").click();
  await expect(page.getByTestId("input-project-name")).toBeVisible({ timeout: 15000 });

  await expectNoConsoleErrors([
    {
      // 客户端导航瞬间 URL 未切到 /settings/info 也可能完成响应 → 不钉页面，靠 /info 收口
      pageUrlPattern: ".*",
      textPattern: "\\[http 500\\] GET .*/info",
      reason: "本用例主动模拟 /info 500（route.fulfill），非产品缺陷",
    },
    {
      pageUrlPattern: ".*",
      textPattern: "Failed to load resource: the server responded with a status of 500",
      reason: "浏览器对上述模拟 500 的自动 console 记录，非产品缺陷",
    },
  ]);
});
