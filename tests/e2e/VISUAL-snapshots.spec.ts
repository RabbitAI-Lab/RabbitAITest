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
  const MOCK_URL = "http://127.0.0.1:4001/hello"; // e2e mock 恒 :4001（global-setup 独占；不读 E2E_MOCK_URL 旧 4000 值）
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

/* ── Sprint 2 页面快照（rules/testing.md §3.6/§3.7：apis / apis-detail / environments /
 *    files / tasks / reports 列表稳定态，供 GLM-5.3-Flash 多模态还原度比对）── */

test("VISUAL-apis 接口定义列表（含示例数据）", async ({ authedPage, page, request }) => {
  const { projectId } = authedPage;
  // 数据准备走 API（贴近原型示例：一条 GET /pets/{id} 定义）
  const mods = await request.get(`/api/v1/projects/${projectId}/modules?scene=api`);
  const modId = ((await mods.json()) as { data: { items: { id: string }[] } }).data.items[0].id;
  await request.post(`/api/v1/projects/${projectId}/apis`, {
    data: {
      moduleId: modId,
      name: "查询宠物",
      request: {
        spec: {
          method: "GET",
          url: "/pets/{id}",
          headers: [],
          query: [{ key: "kind", value: "dog", enabled: true }],
          body: { kind: "none" },
          auth: { kind: "none" },
          timeoutMs: 10000,
          followRedirects: false,
          skipPre: false,
          skipPost: false,
        },
        asserts: [{ kind: "status_code", path: "", op: "eq", expected: "200" }],
        pre: [],
        post: [],
        extracts: [],
      },
      response: { status: 200, headers: [], body: '{"code":0,"data":{"kind":"dog"}}' },
    },
  });
  await navFromHome(page, "接口定义");
  await expect(page.getByRole("row", { name: /查询宠物/ })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SNAP_DIR}/apis.png` });
});

test("VISUAL-apis-detail 接口定义详情（七区编辑器）", async ({ authedPage, page, request }) => {
  const { projectId } = authedPage;
  // 数据准备走 API（用例间项目隔离，不共享 VISUAL-apis 的数据）
  const mods = await request.get(`/api/v1/projects/${projectId}/modules?scene=api`);
  const modId = ((await mods.json()) as { data: { items: { id: string }[] } }).data.items[0].id;
  const created = await request.post(`/api/v1/projects/${projectId}/apis`, {
    data: {
      moduleId: modId,
      name: "查询宠物",
      request: {
        spec: {
          method: "GET",
          url: "/pets/{id}",
          headers: [],
          query: [{ key: "kind", value: "dog", enabled: true }],
          body: { kind: "none" },
          auth: { kind: "none" },
          timeoutMs: 10000,
          followRedirects: false,
          skipPre: false,
          skipPost: false,
        },
        asserts: [{ kind: "status_code", path: "", op: "eq", expected: "200" }],
        pre: [],
        post: [],
        extracts: [],
      },
      response: { status: 200, headers: [], body: '{"code":0,"data":{"kind":"dog"}}' },
    },
  });
  expect(created.status()).toBe(201);
  await navFromHome(page, "接口定义");
  await page.getByRole("link", { name: "查询宠物" }).first().click();
  await expect(page.getByTestId("req-tab-params")).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SNAP_DIR}/apis-detail.png`, fullPage: true });
});

test("VISUAL-environments 环境管理列表（含示例数据）", async ({ authedPage, page, request }) => {
  const { projectId } = authedPage;
  await request.post(`/api/v1/projects/${projectId}/environments`, {
    data: {
      name: "测试环境",
      config: {
        vars: [{ key: "base", value: "http://127.0.0.1:4001", enabled: true }],
        http: [
          {
            id: "def",
            name: "默认",
            protocol: "http",
            hostname: "127.0.0.1",
            port: 4001,
            pathPrefix: "",
            conditions: {},
          },
        ],
        hosts: [],
        database: [],
        pre: [],
        post: [],
        asserts: [],
        extracts: [],
      },
    },
  });
  await navFromHome(page, "环境管理");
  await expect(page.getByTestId("env-list-table").getByText("测试环境")).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SNAP_DIR}/environments.png` });
});

test("VISUAL-files 文件管理（含示例数据）", async ({ authedPage, page }) => {
  await navFromHome(page, "文件管理");
  await expect(page.getByTestId("file-list-table")).toBeVisible();
  await page
    .getByTestId("file-upload")
    .locator("input[type=file]")
    .setInputFiles({
      name: "测试数据.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("id,name\n1,登录\n", "utf8"),
    });
  await expect(page.getByRole("row", { name: /测试数据\.csv/ })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SNAP_DIR}/files.png` });
});

test("VISUAL-tasks 任务中心（含示例任务）", async ({ authedPage, page }) => {
  const { projectId } = authedPage;
  // 数据准备：一个成功的调试任务
  await page.request.post(`/api/v1/projects/${projectId}/exec-tasks`, {
    data: {
      type: "api_debug",
      request: {
        method: "GET",
        url: "http://127.0.0.1:4001/hello",
        headers: [],
        query: [],
        body: { kind: "none" },
        auth: { kind: "none" },
        timeoutMs: 10000,
        followRedirects: false,
        skipPre: false,
        skipPost: false,
      },
      asserts: [{ kind: "status_code", path: "", op: "eq", expected: "200" }],
      pre: [],
      post: [],
      extracts: [],
    },
  });
  await navFromHome(page, "任务中心");
  await expect(page.getByTestId("task-list-table").getByText("SUCCESS").first()).toBeVisible({
    timeout: 20000,
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SNAP_DIR}/tasks.png` });
});

test("VISUAL-reports 接口报告列表（含示例数据）", async ({ authedPage, page, request }) => {
  const { projectId } = authedPage;
  // 数据准备（API）：一个 SUCCESS 的 api_case 报告（用例间项目隔离）
  const mods = await request.get(`/api/v1/projects/${projectId}/modules?scene=api`);
  const modId = ((await mods.json()) as { data: { items: { id: string }[] } }).data.items[0].id;
  const defRes = await request.post(`/api/v1/projects/${projectId}/apis`, {
    data: {
      moduleId: modId,
      name: "查询宠物",
      request: {
        spec: {
          method: "GET",
          url: "http://127.0.0.1:4001/hello",
          headers: [],
          query: [],
          body: { kind: "none" },
          auth: { kind: "none" },
          timeoutMs: 10000,
          followRedirects: false,
          skipPre: false,
          skipPost: false,
        },
        asserts: [{ kind: "status_code", path: "", op: "eq", expected: "200" }],
        pre: [],
        post: [],
        extracts: [],
      },
      response: { status: 200, headers: [], body: '{"code":0}' },
    },
  });
  const defId = ((await defRes.json()) as { data: { id: string } }).data.id;
  const caseRes = await request.post(`/api/v1/projects/${projectId}/apis/${defId}/cases`, {
    data: {
      name: "正常查询用例",
      level: "P1",
      status: "UNDERWAY",
      tags: [],
      request: {
        spec: {
          method: "GET",
          url: "http://127.0.0.1:4001/hello",
          headers: [],
          query: [],
          body: { kind: "none" },
          auth: { kind: "none" },
          timeoutMs: 10000,
          followRedirects: false,
          skipPre: false,
          skipPost: false,
        },
        asserts: [{ kind: "status_code", path: "", op: "eq", expected: "200" }],
        pre: [],
        post: [],
        extracts: [],
      },
    },
  });
  const caseId = ((await caseRes.json()) as { data: { id: string } }).data.id;
  const taskRes = await request.post(`/api/v1/projects/${projectId}/apis/${defId}/cases/execute`, {
    data: { caseIds: [caseId] },
  });
  expect(taskRes.status()).toBe(201);
  // 轮询终态（报告行出现）
  for (let i = 0; i < 30; i++) {
    const r = await request.get(`/api/v1/projects/${projectId}/reports`);
    const items = ((await r.json()) as { data: { items: { taskStatus: string }[] } }).data.items;
    if (items.some((it) => it.taskStatus === "SUCCESS")) break;
    await new Promise((res) => setTimeout(res, 500));
  }
  await navFromHome(page, "接口报告");
  await expect(
    page.getByTestId("report-list-table").getByTestId("report-name-link").first(),
  ).toBeVisible({
    timeout: 15000,
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SNAP_DIR}/reports.png` });
});
