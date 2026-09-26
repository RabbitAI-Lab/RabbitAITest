import { test, expect, navFromHome } from "./fixtures";

/**
 * 视觉快照用例（rules/testing.md §3.7）：为「高保真 ↔ 实现」还原度比对提供稳定截图。
 * 约定：视口 1280×800 对齐原型画布；页面处于无 toast/无loading 的稳定态；
 * 内容尽量贴近原型示例数据（一条 P0 用例等）。产物：tests/visual/snapshots/*.png
 */
test.use({ viewport: { width: 1280, height: 800 } });

// 相对 playwright 进程 cwd（仓库根）落盘，避免相对 tests/ 产生歧义
const SNAP_DIR = "tests/visual/snapshots";

test("VISUAL-login 登录页", async ({ page }) => {
  // 用户路径：首页（未登录被守卫送至登录页）
  await page.goto("/");
  await expect(page.getByTestId("login-form")).toBeVisible();
  // 样式加载断言（2026-09-26 事故回归：Tailwind 未安装导致工具类全失效，录屏完全无样式）
  const authBg = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector(".auth-bg")!).minHeight),
  );
  expect(authBg).toBeGreaterThanOrEqual(790); // min-h-screen 生效 ⇔ Tailwind 已加载（800px 视口解析值）
  await page.screenshot({ path: `${SNAP_DIR}/login.png` });
});

test("VISUAL-dashboard 工作台", async ({ authedPage, page }) => {
  void authedPage;
  await page.goto("/");
  await expect(page.getByTestId("topbar")).toBeVisible();
  // 样式加载断言：h-12 顶栏 = 48px；w-[208px] 侧栏 = 208px
  const bar = await page.evaluate(
    () => getComputedStyle(document.querySelector("[data-testid=topbar]")!).height,
  );
  const nav = await page.evaluate(
    () => getComputedStyle(document.querySelector("[data-testid=leftnav]")!).width,
  );
  expect(bar).toBe("48px");
  expect(nav).toBe("208px");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SNAP_DIR}/dashboard.png` });
});

test("VISUAL-case-list 用例列表（含示例数据）", async ({ authedPage, page, request }) => {
  // 数据准备走 API（不占用户路径镜头）
  await request.post("/api/v1/projects/" + authedPage.projectId + "/cases", {
    data: {
      name: "登录成功场景",
      precondition: "已注册账号；网络可达",
      steps: [
        { desc: "打开登录页输入正确账号密码", expect: "跳转工作台，顶栏显示用户名" },
        { desc: "刷新页面", expect: "会话保持仍在工作台" },
      ],
      level: "P0",
      tags: ["冒烟"],
    },
  });
  await navFromHome(page, "测试用例");
  await expect(page.getByText("登录成功场景")).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SNAP_DIR}/case-list.png` });
});

test("VISUAL-case-form 新建用例表单", async ({ authedPage, page }) => {
  void authedPage;
  await navFromHome(page, "测试用例");
  await page.getByTestId("btn-new-case").click();
  await expect(page.getByTestId("case-form")).toBeVisible();
  await page.getByTestId("case-name").fill("登录成功场景");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SNAP_DIR}/case-form.png` });
});

test("VISUAL-debug 调试台", async ({ authedPage, page }) => {
  void authedPage;
  await navFromHome(page, "接口调试");
  await expect(page.getByTestId("debug-url")).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SNAP_DIR}/debug.png` });
});

test("VISUAL-report 执行报告（失败态展示断言明细）", async ({ authedPage, page }) => {
  const MOCK_URL = process.env.E2E_MOCK_URL ?? "http://127.0.0.1:4000/hello";
  await navFromHome(page, "接口调试");
  await page.getByTestId("debug-url").fill(MOCK_URL);
  await page.getByRole("tab", { name: "断言" }).click();
  await page.getByTestId("debug-asserts").locator('input[placeholder="200"]').fill("404");
  await page.getByTestId("btn-execute").click();
  await expect(page).toHaveURL(/\/reports\//, { timeout: 15000 });
  await expect(page.getByTestId("report-status")).toHaveText("FAILED", { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SNAP_DIR}/report.png`, fullPage: true });
});
