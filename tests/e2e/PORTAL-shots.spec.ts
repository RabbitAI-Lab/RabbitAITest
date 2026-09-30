import { test, expect, navFromHome } from "./fixtures";
import {
  createScenario,
  saveSteps,
  customStep,
  loopForeachStep,
  waitStep,
} from "./s3-helpers";

/**
 * 门户站（portal/）真实界面截图采集——非 CI 用例，站点素材复采工具。
 * 复用 VISUAL-snapshots 的造数模式（数据准备走 API，页面走用户路径），
 * 产物：portal/assets/shots/*.png（1440×900 视口）。
 * 运行：PORTAL_SHOTS=1 pnpm test:e2e PORTAL-shots（默认 CI/本地 e2e 全量恒跳过，
 * portal-shots 依赖 fixtures/s3-helpers 须留在 testDir 内——INFRA-006 收编登记）。
 */

test.skip(process.env.PORTAL_SHOTS !== "1", "门户站截图采集：仅 PORTAL_SHOTS=1 时运行");

test.use({ viewport: { width: 1440, height: 900 } });

const SHOTS = "portal/assets/shots";
const MOCK_URL = "http://127.0.0.1:4001/hello";

test("PORTAL-login 登录页", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("login-form")).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/login.png` });
});

test("PORTAL-dashboard 工作台", async ({ authedPage, page }) => {
  void authedPage;
  await page.goto("/");
  await expect(page.getByTestId("topbar")).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/dashboard.png` });
});

test("PORTAL-case-list 用例列表", async ({ authedPage, page, request }) => {
  const cases = [
    {
      name: "登录成功场景",
      precondition: "已注册账号；网络可达",
      steps: [
        { desc: "打开登录页输入正确账号密码", expect: "跳转工作台，顶栏显示用户名" },
        { desc: "刷新页面", expect: "会话保持仍在工作台" },
      ],
      level: "P0",
      tags: ["冒烟"],
    },
    {
      name: "密码连续错误锁定账号",
      precondition: "已注册账号",
      steps: [{ desc: "连续 5 次输入错误密码", expect: "账号锁定并提示解锁等待时长" }],
      level: "P1",
      tags: ["安全"],
    },
    {
      name: "弱密码注册拦截",
      precondition: "无",
      steps: [{ desc: "使用纯数字 6 位密码注册", expect: "提示密码需≥8位且含字母与数字" }],
      level: "P1",
      tags: ["安全", "边界值"],
    },
  ];
  for (const c of cases) {
    await request.post(`/api/v1/projects/${authedPage.projectId}/cases`, { data: c });
  }
  await navFromHome(page, "测试用例");
  await expect(page.getByText("登录成功场景")).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/case-list.png` });
});

test("PORTAL-case-mindmap 脑图模式", async ({ authedPage, page, request }) => {
  const pid = authedPage.projectId;
  await request.post(`/api/v1/projects/${pid}/cases`, {
    data: {
      name: "登录成功场景",
      steps: [
        { desc: "打开登录页输入正确账号密码", expect: "跳转工作台" },
        { desc: "刷新页面", expect: "会话保持" },
      ],
      level: "P0",
      tags: ["冒烟"],
    },
  });
  await request.post(`/api/v1/projects/${pid}/cases`, {
    data: {
      name: "密码错误锁定",
      steps: [{ desc: "连续输错密码 5 次", expect: "账号锁定" }],
      level: "P1",
      tags: [],
    },
  });
  await navFromHome(page, "测试用例");
  await page.getByTestId("view-mindmap").click();
  await expect(page.getByTestId("mindmap-canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("mindmap-canvas")).toContainText("登录成功场景", {
    timeout: 15_000,
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/case-mindmap.png` });
});

test("PORTAL-apis 接口定义列表", async ({ authedPage, page, request }) => {
  const pid = authedPage.projectId;
  const mods = await request.get(`/api/v1/projects/${pid}/modules?scene=api`);
  const modId = (((await mods.json()) as { data: { items: { id: string }[] } }).data.items[0]).id;
  const spec = {
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
  };
  await request.post(`/api/v1/projects/${pid}/apis`, {
    data: {
      moduleId: modId,
      name: "查询宠物",
      request: { spec, asserts: [{ kind: "status_code", path: "", op: "eq", expected: "200" }], pre: [], post: [], extracts: [] },
      response: { status: 200, headers: [], body: '{"code":0,"data":{"kind":"dog"}}' },
    },
  });
  await request.post(`/api/v1/projects/${pid}/apis`, {
    data: {
      moduleId: modId,
      name: "创建订单",
      request: { spec: { ...spec, method: "POST", url: "/orders" }, asserts: [], pre: [], post: [], extracts: [] },
      response: { status: 200, headers: [], body: '{"code":0}' },
    },
  });
  await navFromHome(page, "接口定义");
  await expect(page.getByRole("row", { name: /查询宠物/ })).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/apis.png` });
});

test("PORTAL-apis-detail 接口定义详情", async ({ authedPage, page, request }) => {
  const pid = authedPage.projectId;
  const mods = await request.get(`/api/v1/projects/${pid}/modules?scene=api`);
  const modId = (((await mods.json()) as { data: { items: { id: string }[] } }).data.items[0]).id;
  await request.post(`/api/v1/projects/${pid}/apis`, {
    data: {
      moduleId: modId,
      name: "查询宠物",
      request: {
        spec: {
          method: "GET",
          url: "/pets/{id}",
          headers: [{ key: "X-Request-Id", value: "${requestId}", enabled: true }],
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
  await page.getByRole("link", { name: "查询宠物" }).first().click();
  await expect(page.getByTestId("req-tab-params")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/apis-detail.png`, fullPage: true });
});

test("PORTAL-debug 接口调试台", async ({ authedPage, page }) => {
  void authedPage;
  await navFromHome(page, "接口调试");
  await expect(page.getByTestId("debug-url")).toBeVisible();
  await page.getByTestId("debug-url").fill(MOCK_URL);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/debug.png` });
});

test("PORTAL-scenario 场景编排（含循环/请求/等待步骤）", async ({ authedPage, page, request }) => {
  const pid = authedPage.projectId;
  const sc = await createScenario(request, pid, { name: "下单冒烟场景" });
  await saveSteps(request, pid, sc.id, [
    customStep("查询商品", MOCK_URL, [{ kind: "status_code", path: "", op: "eq", expected: "200" }]),
    loopForeachStep("遍历购物车", "cartList", customStep("提交订单", MOCK_URL)),
    waitStep("等待库存同步", 500),
  ]);
  await navFromHome(page, "接口场景");
  await page.getByTestId(`scenario-name-${sc.num}`).click();
  await expect(page.getByTestId("input-scenario-name")).toHaveValue("下单冒烟场景");
  await expect(page.getByTestId("step-tree-panel")).toContainText("遍历购物车");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/scenario-editor.png`, fullPage: true });
});

test("PORTAL-plans 测试计划", async ({ authedPage, page }) => {
  void authedPage;
  await navFromHome(page, "测试计划");
  await page.getByTestId("btn-new-plan").click();
  await page.getByTestId("input-plan-name").fill("v1.0 发布回归计划");
  await page.getByTestId("input-threshold").fill("80");
  await page.getByTestId("btn-submit-plan").click();
  await expect(page.getByRole("link", { name: "v1.0 发布回归计划" })).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/plans.png` });
});

test("PORTAL-report 报告详情（失败断言明细）", async ({ authedPage, page }) => {
  void authedPage;
  await navFromHome(page, "接口调试");
  await page.getByTestId("debug-url").fill(MOCK_URL);
  await page.getByRole("tab", { name: "断言" }).click();
  await page.getByTestId("debug-asserts").locator('input[placeholder="200"]').fill("404");
  await page.getByTestId("btn-execute").click();
  await expect(page).toHaveURL(/\/reports\//, { timeout: 15_000 });
  await expect(page.getByTestId("report-status")).toHaveText("FAILED", { timeout: 30_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/report.png`, fullPage: true });
});

test("PORTAL-reports 报告列表", async ({ authedPage, page, request }) => {
  const pid = authedPage.projectId;
  await request.post(`/api/v1/projects/${pid}/exec-tasks`, {
    data: {
      type: "api_debug",
      request: {
        method: "GET",
        url: MOCK_URL,
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
  // 先经 API 轮询终态（报告列表页不自动刷新，须终态后进入；列表状态列文案为「成功/失败」非 SUCCESS）
  for (let i = 0; i < 60; i++) {
    const r = await request.get(`/api/v1/projects/${pid}/reports`);
    const items = ((await r.json()) as { data: { items: { taskStatus: string }[] } }).data.items;
    if (items.some((it) => it.taskStatus === "SUCCESS")) break;
    await new Promise((res) => setTimeout(res, 1000));
  }
  await navFromHome(page, "接口报告");
  await expect(page.getByTestId("report-list-table").getByText("成功").first()).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/reports.png` });
});

test("PORTAL-ai-assistant AI 智能助手对话", async ({ authedPage, page }) => {
  void authedPage;
  await page.goto("/");
  await page.getByTestId("topbar-ai-assistant").click();
  await expect(page.getByTestId("ai-assistant-drawer")).toBeVisible();
  await page.getByTestId("ai-chat-input").fill("密码锁定策略怎么设计用例？");
  await page.getByTestId("ai-chat-send").click();
  await expect(
    page.getByTestId("ai-chat-messages").getByText(/边界值/),
  ).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/ai-assistant.png` });
});

test("PORTAL-environments 环境管理", async ({ authedPage, page, request }) => {
  const pid = authedPage.projectId;
  await request.post(`/api/v1/projects/${pid}/environments`, {
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
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/environments.png` });
});

test("PORTAL-tasks 任务中心", async ({ authedPage, page }) => {
  const pid = authedPage.projectId;
  await page.request.post(`/api/v1/projects/${pid}/exec-tasks`, {
    data: {
      type: "api_debug",
      request: {
        method: "GET",
        url: MOCK_URL,
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
    timeout: 30_000,
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/tasks.png` });
});
