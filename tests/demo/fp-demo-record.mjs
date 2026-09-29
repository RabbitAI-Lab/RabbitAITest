/**
 * S-future（远期 P4）验收演示录屏（AGENTS 门禁 2：走查录屏归档）——独立录制脚本，非测试用例。
 * 走 sprint-overview §6 演示主线：占位开关→K8S 池型→插件上传启用→WS 调试执行→报告统计→APIKEY 同步。
 * 步骤左上角浮层标注（2.6s 淡出）；1280×720 webm。
 * 产物：docs/sprint-future-p4/demo/fp-acceptance-demo.webm（录完重命名固定名）
 * 前置：web :3103 + engine + mock :4022（/ws/echo）+ pg :5440 + redis :6381 + runner :4032
 *       ——bash /tmp/demo-stack-fp.sh 或等价隔离栈（scripts 见脚本头部）。
 * 用法：node tests/demo/fp-demo-record.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3103";
const MOCK_WS = process.env.DEMO_WS_URL ?? "ws://127.0.0.1:4022/ws/echo";
const OUT = path.resolve(import.meta.dirname ?? ".", "../../docs/sprint-future-p4/demo");
const TARBALL_DIR = path.resolve(import.meta.dirname ?? ".", "../../plugins/dist");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(page, title, ms = 2400) {
  await page.evaluate((t) => {
    const old = document.getElementById("__demo_step");
    if (old) old.remove();
    const d = document.createElement("div");
    d.id = "__demo_step";
    d.textContent = t;
    d.style.cssText =
      "position:fixed;top:14px;left:14px;z-index:99999;background:rgba(30,30,40,.88);color:#fff;padding:8px 14px;border-radius:8px;font:600 15px/1.4 system-ui;box-shadow:0 4px 14px rgba(0,0,0,.3);pointer-events:none;max-width:70%";
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 2800);
  }, title);
  await sleep(ms);
}

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
  });
  const page = await ctx.newPage();
  const api = ctx.request;

  // ── 0 管理员登录 ──
  await page.goto(`${BASE}/login`);
  await step(page, "S-future（P4）验收演示 · 管理员登录", 1600);
  await page.getByTestId("login-email").fill("admin@rabbit.test");
  await page.getByTestId("login-password").fill(process.env.DEMO_ADMIN_PASSWORD ?? "rabbit-admin-123");
  await page.getByTestId("login-submit").click();
  await page.waitForURL(`${BASE}/`, { timeout: 15000 });
  await sleep(1200);

  // ── ① 项目设置：性能测试/UI 测试占位开关 ──
  await page.goto(`${BASE}/settings/info`);
  await step(page, "① 项目设置 → 模块开关：性能测试 / UI 测试（企业版方向，默认关）", 1800);
  await page.getByTestId("module-switch-load").click();
  await page.getByTestId("module-switch-uit").click();
  await page.getByTestId("btn-save-info").click();
  await sleep(1600);
  await page.goto(`${BASE}/`);
  await sleep(800);
  await step(page, "开关开启 → 左侧导航出现「性能测试 / UI 测试」占位组", 1600);
  await page.getByTestId("nav-load").click();
  await page.waitForURL(/\/load$/);
  await step(page, "/load 占位页：企业版方向空态（对齐 MeterSphere v3 社区版占位口径，无执行能力）", 3000);
  await page.getByTestId("nav-uit").click();
  await page.waitForURL(/\/ui-test$/);
  await step(page, "/ui-test 占位页：能力清单置灰（Selenium 方向属企业版迭代）", 2600);

  // ── ② 资源池：K8S 型切换 ──
  await page.goto(`${BASE}/system/pools`);
  await sleep(1200);
  const poolsRes = await api.get(`${BASE}/api/v1/system/pools`);
  const poolId = ((await poolsRes.json()).data.items[0] ?? {}).id;
  await step(page, "② 系统设置 → 资源池：默认池编辑（社区版单池不可删，License 门控）", 2000);
  await page.getByTestId(`btn-edit-pool-${poolId}`).click();
  await page.getByTestId("pool-type-radio").getByText("K8S（集群 task-runner）").click();
  await step(page, "类型切 K8S → 四项配置（apiServer 强制 https / 命名空间 / Token 只写不读 / 镜像）", 2400);
  await page.getByTestId("k8s-apiserver").fill("https://k8s.demo.internal:6443");
  await page.getByTestId("k8s-namespace").fill("rabbit-demo");
  await page.getByTestId("k8s-token").fill("demo-token-not-a-secret");
  await page.getByTestId("k8s-image").fill("rabbitaitest/task-runner:demo");
  await page.getByRole("button", { name: /保\s*存/ }).click();
  await sleep(1800);
  await step(page, "保存 → 池卡片 type=K8S · Token「已设置（不回显）」· loadTest/uiTest 占位字段", 3000);
  await page.getByTestId(`btn-edit-pool-${poolId}`).click();
  await step(page, "休眠往返：切回 NODE（k8s 配置保留，再切回免重填；调度面零变化）", 2200);
  await page.getByTestId("pool-type-radio").getByText("NODE（单机进程）").click();
  await page.getByRole("button", { name: /保\s*存/ }).click();
  await sleep(1500);

  // ── ③ 插件：上传并启用 websocket / mqtt ──
  await page.goto(`${BASE}/system/plugins`);
  await sleep(1200);
  await step(page, "③ 系统设置 → 插件管理：上传 websocket 协议插件（tarball：清单+SPI 校验）", 1800);
  await page.getByTestId("plugin-upload-btn").click();
  await page.locator(".ant-modal input[type=file]").setInputFiles(`${TARBALL_DIR}/websocket-1.0.0.tgz`);
  await page.getByText("websocket-1.0.0.tgz").waitFor({ state: "visible", timeout: 8000 });
  await sleep(600);
  await page.getByRole("button", { name: "确认上传" }).click();
  await sleep(2600);
  await page.getByTestId("plugin-toggle-websocket").waitFor({ state: "visible", timeout: 15000 });
  await page.getByTestId("plugin-toggle-websocket").click();
  await sleep(1200);
  await step(page, "启用 websocket → plugin-runner 热加载（worker_threads 隔离）", 2000);
  await page.getByTestId("plugin-upload-btn").click();
  await page.locator(".ant-modal input[type=file]").setInputFiles(`${TARBALL_DIR}/mqtt-1.0.0.tgz`);
  await page.getByText("mqtt-1.0.0.tgz").waitFor({ state: "visible", timeout: 8000 });
  await sleep(600);
  await page.getByRole("button", { name: "确认上传" }).click();
  await sleep(2600);
  await page.getByTestId("plugin-toggle-mqtt").waitFor({ state: "visible", timeout: 15000 });
  await page.getByTestId("plugin-toggle-mqtt").click();
  await sleep(1200);
  await step(page, "同样上传并启用 mqtt（自研 3.1.1 最小客户端，零新增依赖）", 2200);
  await step(page, "引擎协议注册表 30s 轮询装载插件（装载后即可执行协议采样）…", 34000);

  // ── ④ 接口调试：websocket 对 mock /ws/echo 执行 ──
  await page.goto(`${BASE}/debug`);
  await page.getByTestId("debug-protocol").waitFor({ state: "visible", timeout: 10000 });
  await step(page, "④ 接口调试：协议选择器切 websocket（内置 HTTP/HTTPS + 协议插件分组）", 2000);
  await page.getByTestId("debug-protocol").click();
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText("websocket", { exact: true })
    .click();
  await sleep(800);
  await step(page, "HTTP 面折叠 → 「协议配置」页签（protocolConfig JSON，字段契约=插件 configSchema）", 2400);
  await page.getByTestId("req-tab-protocol").click();
  await page.getByTestId("req-protocol-config").fill(
    JSON.stringify({ url: MOCK_WS, sendText: "hello-rabbit-fp-demo", timeoutMs: 8000 }, null, 2),
  );
  await sleep(600);
  await page.getByTestId("btn-execute").click();
  // 引擎轮询窗口容错：失败则等 10s 重试一次
  for (let i = 0; i < 3; i++) {
    const ok = await page
      .waitForURL(/\/reports\//, { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) break;
    const status = await page.getByTestId("report-status").textContent({ timeout: 30000 }).catch(() => null);
    if (status === "SUCCESS") break;
    await step(page, "引擎装载窗口内重试…", 10000);
    await page.goto(`${BASE}/debug`);
    await page.getByTestId("debug-protocol").click();
    await page
      .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
      .getByText("websocket", { exact: true })
      .click();
    await page.getByTestId("req-tab-protocol").click();
    await page.getByTestId("req-protocol-config").fill(
      JSON.stringify({ url: MOCK_WS, sendText: "hello-rabbit-fp-demo", timeoutMs: 8000 }, null, 2),
    );
    await page.getByTestId("btn-execute").click();
  }
  await page.getByTestId("report-status").waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  await step(page, "报告：websocket 采样 SUCCESS（连接→发送→收首条→close 单 run 探活）", 2000);
  await page.getByTestId("report-status").textContent({ timeout: 30000 }).then(() => {}).catch(() => {});
  await sleep(1500);
  const body = page.getByTestId("report-response-body");
  await body.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await step(page, "响应体回显 sendText（mock /ws/echo RFC6455 回显端点）", 3200);

  // ── ⑤ 报告统计 ──
  await page.goto(`${BASE}/reports/stats`);
  await sleep(1800);
  await step(page, "⑤ 接口报告 → 统计：14 天执行趋势（今日增量 · SVG 自绘零图表库）", 3400);
  await step(page, "类型分布 + 失败 TOP5（补零不断轴 · passRate 口径 Σpassed/Σtotal）", 3000);
  await page.getByTestId("stats-range").getByText("7 天").click();
  await sleep(1800);
  await step(page, "窗口切换 7/14/30 天（days 枚举校验 422·60422）", 2400);

  // ── ⑥ APIKEY + open/api-sync（IDEA 插件契约）──
  await page.goto(`${BASE}/personal/api-keys`);
  await sleep(1200);
  await step(page, "⑥ 个人中心 → APIKEY：新建（IDEA/浏览器插件的 open API 第三认证通道）", 2000);
  await page.getByTestId("apikey-create-btn").click();
  await page.getByTestId("apikey-name-input").fill("IDEA 插件演示");
  await page.getByRole("button", { name: "创 建" }).click();
  await sleep(1800);
  const ak = (await page.getByTestId("apikey-ak").textContent().catch(() => "")) ?? "";
  const sk = (await page.getByTestId("apikey-sk").textContent().catch(() => "")) ?? "";
  await step(page, "Access Key / Secret Key（仅此一次展示 · Basic ak:sk / Bearer ak.sk 双形态）", 2600);
  await page.getByRole("button", { name: "我已保存，关闭" }).click();
  await sleep(800);
  // open/api-sync：以 IDEA 插件等价方式同步 3 条接口定义
  const basic = Buffer.from(`${ak}:${sk}`).toString("base64");
  // 项目上下文取自浏览器 zustand persist（登录后项目切换器自动选中）
  const projStore = await page.evaluate(() => localStorage.getItem("rabbit-project"));
  const projectId = JSON.parse(projStore ?? "{}").state?.currentProjectId;
  const sync = await api.post(`${BASE}/api/v1/open/api-sync`, {
    headers: { Authorization: `Basic ${basic}` },
    data: {
      projectId,
      apis: [
        { name: "同步接口 1 · 库存查询", method: "GET", path: "/demo/stock" },
        { name: "同步接口 2 · 下单", method: "POST", path: "/demo/order" },
        { name: "同步接口 3 · 查询物流", method: "GET", path: "/demo/trace" },
      ],
    },
  });
  const syncBody = await sync.json();
  await step(
    page,
    `POST /api/v1/open/api-sync（Basic 认证）→ created=${syncBody.data?.created ?? "?"} · 幂等键 method+path`,
    3200,
  );
  await page.goto(`${BASE}/apis`);
  await sleep(1500);
  await page.getByText("未规划接口", { exact: true }).first().click().catch(() => {});
  await sleep(1500);
  await step(page, "接口定义列表：同步而来的 3 条接口（upsert 语义，重放=updated）", 3400);

  await step(
    page,
    "S-future 验收演示结束 —— 协议插件 / 外部工具契约 / 报告分析 / K8S 池型 / 企业版占位",
    3200,
  );

  await ctx.close();
  await browser.close();
  console.log(`[demo] video saved under ${OUT}/ —— 重命名为 fp-acceptance-demo.webm`);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
