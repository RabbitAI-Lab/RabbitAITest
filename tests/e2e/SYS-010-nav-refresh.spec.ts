import { test, expect, enterRealm, navClick } from "./fixtures";
import { E2E_BASE } from "./env";

/**
 * SYS-010 全局导航改版：三域（项目/组织/系统）+ 浏览器式多标签页 + 侧栏折叠/收起。
 * 三类断言：UI（域隔离/标签/收起）+ Console（全程无错）+ 接口（域切换触发的页面数据请求）。
 * 权限二态：authedPage（组织 owner，无 SYSTEM_*）下拉可见组织管理/不可见系统设置；
 *           种子 admin 两项皆可见（SYS-010-04）。
 */

test("SYS-010-01 三域侧栏隔离与头像下拉入口（组织域）", async ({
  page,
  authedPage,
  expectNoConsoleErrors,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("tab-bar")).toBeVisible();
  // 项目域：无组织/系统组、无个人中心（⑦轮），工作台直点
  for (const t of ["nav-org-projects", "nav-system-users", "nav-personal-center"]) {
    await expect(page.getByTestId(t)).toHaveCount(0);
  }
  // 头像下拉：个人中心/组织管理可见（组织 owner）
  await page.getByTestId("user-avatar").click();
  await expect(page.getByTestId("menu-org-management")).toBeVisible();
  await page.getByTestId("menu-org-management").click();
  await page.waitForURL(/\/org\//);
  // 组织域：仅组织菜单 + 返回项目 + 顶栏域标识；项目菜单不残留
  await expect(page.getByTestId("nav-org-projects")).toBeVisible();
  await expect(page.getByTestId("back-to-project")).toBeVisible();
  await expect(page.getByTestId("nav-apis")).toHaveCount(0);
  await expect(page.getByText("组织级 · 跨项目")).toBeVisible();
  // 返回项目
  await page.getByTestId("back-to-project").click();
  await page.waitForURL("/");
  await expect(page.getByTestId("nav-apis")).toBeVisible();
  await expect(page.getByTestId("nav-org-projects")).toHaveCount(0);
  await expectNoConsoleErrors();
});

test("SYS-010-02 多标签：多开/切换/单关相邻激活/固定工作台", async ({
  page,
  authedPage,
  expectNoConsoleErrors,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("tab-/")).toBeVisible(); // 工作台固定标签
  // 多开：接口定义 → 缺陷管理（折叠组自动展开经 navClick）
  await navClick(page, "nav-apis");
  await expect(page.getByTestId("tab-/apis")).toBeVisible();
  await navClick(page, "nav-bugs");
  await expect(page.getByTestId("tab-/bugs")).toBeVisible();
  await expect(page.getByTestId("tab-/bugs")).toHaveClass(/font-medium/);
  // 切换回接口定义标签（不换路由重复激活）
  await page.getByTestId("tab-/apis").click();
  await expect(page.getByTestId("tab-/apis")).toHaveClass(/font-medium/);
  // 单关激活标签（/apis）→ 相邻激活（右侧 /bugs）
  await page.getByTestId("tab-close-/apis").click();
  await expect(page.getByTestId("tab-/apis")).toHaveCount(0);
  await expect(page.getByTestId("tab-/bugs")).toHaveClass(/font-medium/);
  // 工作台固定标签无关闭钮
  await expect(page.getByTestId("tab-close-/")).toHaveCount(0);
  // 关闭后路由跟随激活标签
  await expect(page).toHaveURL(/\/bugs/);
  await expectNoConsoleErrors();
});

test("SYS-010-03 批量关闭（右键菜单 + 批量下拉）", async ({
  page,
  authedPage,
  expectNoConsoleErrors,
}) => {
  await page.goto("/");
  await navClick(page, "nav-apis");
  await navClick(page, "nav-bugs");
  await navClick(page, "nav-tasks");
  await expect(page.getByTestId("tab-bar").locator('[data-testid^="tab-/"]')).toHaveCount(4);
  // 右键菜单：关闭其他（当前=任务中心）
  await page.getByTestId("tab-/tasks").dispatchEvent("contextmenu");
  const ctx = page.getByTestId("tab-ctx-menu");
  await expect(ctx).toBeVisible();
  await ctx.getByRole("button", { name: "关闭其他标签页" }).click();
  await expect(page.getByTestId("tab-bar").locator('[data-testid^="tab-/"]')).toHaveCount(2); // 工作台+任务中心
  // 批量下拉：全部关闭（保留工作台）
  await page.getByTestId("tabs-ops").click();
  await page
    .getByTestId("tab-ops-menu")
    .getByRole("button", { name: "全部关闭（保留工作台）" })
    .click();
  await expect(page.getByTestId("tab-bar").locator('[data-testid^="tab-/"]')).toHaveCount(1);
  await expect(page.getByTestId("tab-/")).toHaveClass(/font-medium/);
  await expect(page).toHaveURL("/");
  await expectNoConsoleErrors();
});

test("SYS-010-04 权限二态：admin 下拉两项可见 + 系统域隔离", async ({
  page,
  request,
  context,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const res = await request.post("/api/v1/auth/login", {
    data: { email: "admin@rabbit.test", password: "rabbit-admin-123" },
  });
  expect(res.status()).toBe(200);
  const ras = (res.headers()["set-cookie"] ?? "").split("ras=")[1]?.split(";")[0];
  await context.addCookies([{ name: "ras", value: ras!, url: E2E_BASE }]);
  await page.goto("/");
  // 接口断言先挂起等待，再触发导航（expectApi=未来事件，导航后调用会错过已发请求）
  const apiP = expectApi("**/api/v1/system/users*", "GET");
  await page.getByTestId("user-avatar").click();
  await expect(page.getByTestId("menu-system-settings")).toBeVisible();
  await page.getByTestId("menu-system-settings").click();
  await page.waitForURL(/\/system\//);
  // 系统域：仅系统菜单 + 顶栏平台级标识；项目/组织菜单不残留
  await expect(page.getByTestId("nav-system-users")).toBeVisible();
  await expect(page.getByText("跨项目 · 平台级")).toBeVisible();
  await expect(page.getByTestId("nav-apis")).toHaveCount(0);
  await expect(page.getByTestId("nav-org-projects")).toHaveCount(0);
  // 接口断言：系统域页面数据请求 200 信封
  const api = await apiP;
  expect(api.status).toBe(200);
  expect(api.code).toBe(0);
  await expectNoConsoleErrors();
});

test("SYS-010-05 侧栏收起/展开 + 分组折叠（含 localStorage 持久化）", async ({ page, authedPage, expectNoConsoleErrors }) => {
  await page.goto("/");
  // 分组折叠（默认接口测试展开、测试管理折叠）：点分组头展开测试管理
  await expect(page.getByTestId("nav-bugs")).toBeHidden();
  await page.getByTestId("leftnav").locator("button", { hasText: "测试管理" }).click();
  await expect(page.getByTestId("nav-bugs")).toBeVisible();
  // 折叠状态 localStorage 持久化：刷新后测试管理保持展开（§1.2 能力行 #4）
  await page.reload();
  await expect(page.getByTestId("nav-bugs")).toBeVisible();
  // 收起：侧栏整体隐藏 + 左缘悬浮展开钮
  await page.getByTestId("rail-toggle").click();
  await expect(page.getByTestId("leftnav")).toHaveCSS("width", "0px");
  await expect(page.getByTestId("rail-expand")).toBeVisible();
  // 展开：恢复
  await page.getByTestId("rail-expand").click();
  await expect(page.getByTestId("leftnav")).not.toHaveCSS("width", "0px");
  await expect(page.getByTestId("rail-expand")).toHaveCount(0);
  await expectNoConsoleErrors();
});

test("SYS-010-06 刷新恢复与跨域标签联动", async ({ page, authedPage, expectNoConsoleErrors }) => {
  await page.goto("/");
  await navClick(page, "nav-apis");
  await enterRealm(page, "org");
  await expect(page.getByTestId("tab-/org/projects")).toBeVisible();
  // 跨域标签共存：项目标签仍在，点回项目标签切回项目域
  await page.getByTestId("tab-/apis").click();
  await expect(page).toHaveURL(/\/apis/);
  await expect(page.getByTestId("nav-org-projects")).toHaveCount(0);
  await expect(page.getByTestId("nav-apis")).toBeVisible();
  // 刷新恢复：组织标签保留、URL 恢复后回到对应域侧栏
  await page.reload();
  await expect(page.getByTestId("tab-/org/projects")).toBeVisible();
  await page.getByTestId("tab-/org/projects").click();
  await expect(page).toHaveURL(/\/org\/projects/);
  await expect(page.getByTestId("nav-org-projects")).toBeVisible();
  await expectNoConsoleErrors();
});

test("SYS-010-07 标签上限 20：超限提示且不新增", async ({ page, authedPage, expectNoConsoleErrors }) => {
  await page.goto("/");
  // 注入 20 个标签（含工作台）后刷新——恢复机制读 sessionStorage
  const tabs = ["/", ...Array.from({ length: 19 }, (_, i) => `/p${i}`)].map((key) => ({ key }));
  await page.evaluate(
    (t) => sessionStorage.setItem("rabbit.tabs.v1", JSON.stringify({ tabs: t, activeKey: "/" })),
    tabs,
  );
  await page.reload();
  // 标签本体计数（tab-/ 前缀不含 tab-close-* 关闭钮）
  const bar = page.getByTestId("tab-bar").locator('[data-testid^="tab-/"]');
  await expect(bar).toHaveCount(20);
  // 再开菜单：出现上限提示且标签数不变
  await navClick(page, "nav-apis");
  await expect(page.getByText("标签已达上限 20 个")).toBeVisible();
  await expect(bar).toHaveCount(20);
  await expectNoConsoleErrors();
});

test("SYS-010-08 预置折叠记忆的首次加载（hydration 对齐防回归：记忆恢复 + 无错）", async ({
  page,
  authedPage,
  expectNoConsoleErrors,
}) => {
  // 走查缺陷（2026-10-01 用户报 hydration mismatch）：折叠记忆经 useState 初始化器直接读
  // localStorage → SSR 首帧默认态 ≠ 客户端记忆态。修复=首帧恒默认、挂载后恢复记忆、恢复完才持久化。
  // 生产构建 React 对属性 mismatch 静默（dev 才报 console.error——已由 dev 栈脚本化红→绿验证，
  // 见 PR 描述）；本用例锁生产行为面：预置记忆 → 挂载后记忆态正确 + 刷新保持 + 全程无 console error。
  await page.addInitScript(() => {
    localStorage.setItem("rabbit.nav.collapsed", JSON.stringify(["api", "uit"]));
  });
  await page.goto("/");
  // 记忆=全量折叠集合：api/uit 折叠；tm 不在记忆=展开（与默认相反向，验证恢复而非默认）
  await expect(page.getByTestId("nav-apis")).toBeHidden();
  await expect(page.getByTestId("nav-uit")).toBeHidden();
  await expect(page.getByTestId("nav-bugs")).toBeVisible();
  // 刷新后保持（持久化在恢复完成后仍工作）
  await page.reload();
  await expect(page.getByTestId("nav-apis")).toBeHidden();
  await expect(page.getByTestId("nav-bugs")).toBeVisible();
  await expectNoConsoleErrors();
});

