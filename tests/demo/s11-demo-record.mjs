/**
 * S11 性能测试/UI 测试验收演示录屏（AGENTS 门禁 2：走查录屏归档）——独立录制脚本，非测试用例。
 * 走 sprint-overview §6 演示主线：License 门控两态 → 性能测试全链（建计划→执行→监控曲线→报告）→
 * UI 测试全链（元素库→步骤编排→chromium 执行→截图报告）→ 恢复社区版。
 * 步骤左上角浮层标注（2.6s 淡出）；1280×720 webm。
 * 产物：docs/sprint-11-load-uit/demo/s11-acceptance-demo.webm
 * 前置：bash /tmp/s11-demo-stack.sh（web :3106 + engine + mock :4206 + pg :5456 + redis :6381）
 * 用法：DEMO_BASE_URL=http://localhost:3106 DEMO_MOCK_BASE=http://127.0.0.1:4206 node tests/demo/s11-demo-record.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3106";
const MOCK = process.env.DEMO_MOCK_BASE ?? "http://127.0.0.1:4206";
const OUT = path.resolve(import.meta.dirname ?? ".", "../../docs/sprint-11-load-uit/demo");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(page, title, ms = 2600) {
  await page.evaluate((t) => {
    const old = document.getElementById("__demo_step");
    if (old) old.remove();
    const d = document.createElement("div");
    d.id = "__demo_step";
    d.textContent = t;
    d.style.cssText =
      "position:fixed;top:14px;left:14px;z-index:99999;background:rgba(30,30,40,.88);color:#fff;padding:8px 14px;border-radius:8px;font:600 15px/1.4 system-ui;box-shadow:0 4px 14px rgba(0,0,0,.3);pointer-events:none;max-width:70%";
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 3000);
  }, title);
  await sleep(ms);
}

/** License 签发（dev 密钥缺省——与 tests/e2e/s9-helpers 同算法）。 */
import { createHmac } from "node:crypto";
function issueLicense(features) {
  const payload = {
    lic: `RAB-DEMO-S11-${Date.now().toString(36).toUpperCase()}`,
    edition: "ENTERPRISE",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    features,
  };
  const seg = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", "rabbit-dev-license-secret").update(seg).digest("base64url");
  return `RABBIT-ENT1.${seg}.${sig}`;
}

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
  });
  const page = await ctx.newPage();
  const api = ctx.request;

  // ── 0 管理员登录 + License 激活（LOAD_TEST/UI_TEST）──
  await page.goto(`${BASE}/login`);
  await step(page, "S11 性能测试 / UI 测试 · 验收演示 · 管理员登录", 1800);
  await page.getByTestId("login-email").fill("admin@rabbit.test");
  await page.getByTestId("login-password").fill(process.env.DEMO_ADMIN_PASSWORD ?? "rabbit-admin-123");
  await page.getByTestId("login-submit").click();
  await page.waitForURL(`${BASE}/`, { timeout: 15000 });
  await sleep(1000);

  const licRes = await api.post(`${BASE}/api/v1/system/license`, {
    data: { code: issueLicense(["LOAD_TEST", "UI_TEST"]) },
  });
  if (!licRes.ok()) throw new Error(`license add failed: ${licRes.status()}`);
  await step(page, "① License 激活（LOAD_TEST / UI_TEST 特性）——三重门控=模块开关 ∧ 权限点 ∧ License", 2400);

  // ── ② 社区版态对照：摘除 License → 占位页 ──
  await api.delete(`${BASE}/api/v1/system/license`);
  await page.goto(`${BASE}/settings/info`);
  await step(page, "② 项目设置 → 模块开关：性能测试 / UI 测试（默认关，企业版方向标记）", 2000);
  await page.getByTestId("module-switch-load").click();
  await page.getByTestId("module-switch-uit").click();
  await page.getByTestId("btn-save-info").click();
  await page.getByText("基本信息已保存").first().waitFor({ timeout: 8000 });
  await page.goto(`${BASE}/load`);
  await step(page, "② 社区版（无 License）→ /load 占位页（与 MeterSphere v3 社区版同口径）", 2600);
  await page.goto(`${BASE}/ui-test`);
  await step(page, "② 社区版 → /ui-test 占位页", 2200);

  // ── ③ 重新激活 License → 真实模块出现 ──
  await api.post(`${BASE}/api/v1/system/license`, {
    data: { code: issueLicense(["LOAD_TEST", "UI_TEST"]) },
  });
  await page.goto(`${BASE}/load`);
  await step(page, "③ License 激活后 → 真实模块：性能测试列表（新建入口）", 2600);

  // ── ④ 性能测试：新建施压计划 ──
  await page.getByTestId("load-create-btn").click();
  await step(page, "④ 新建施压计划：目标 mock /perf/echo，目标 TPS 模式 10s", 1800);
  await page.getByPlaceholder("计划名称").fill(`S11 演示-基线压测-${Date.now() % 100000}`);
  await page.getByPlaceholder("http(s) 绝对 URL（压测目标）").fill(`${MOCK}/perf/echo`);
  // 压力模型：选「目标 TPS」
  await page.locator('[data-testid="load-pressure-form"] .ant-select').first().click();
  const dd = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").last();
  await dd.getByText("目标 TPS（每秒发压配额）").click();
  await page.getByRole("spinbutton", { name: /持续时长/ }).fill("10");
  await page.getByRole("spinbutton", { name: /目标 TPS（1-1000）/ }).fill("8");
  await page.getByRole("spinbutton", { name: /成功率 ≥/ }).fill("50");
  await page.getByRole("spinbutton", { name: /P95 ≤/ }).fill("8000");
  await page.getByRole("spinbutton", { name: /平均 RT ≤/ }).fill("5000");
  await step(page, "④ 压力模型：目标 TPS 8 · 10 秒 · 阈值（成功率/P95/平均 RT）", 2200);
  await page.getByTestId("load-save-btn").click();
  await page.waitForURL(/\/load$/, { timeout: 10000 });
  await page.getByText("S11 演示-基线压测").first().waitFor({ timeout: 8000 });

  // ── ⑤ 执行 → 监控页实时曲线 ──
  const row = page.locator("tr", { hasText: "S11 演示-基线压测" }).first();
  await row.getByTestId(/^load-run-/).click();
  await page.waitForURL(/\/load\/tasks\/[0-9a-f-]{36}/, { timeout: 15000 });
  await step(page, "⑤ 执行中 → 监控页：秒级 TPS/并发/RT 分位曲线（SSE 实时推进）", 5000);
  await step(page, "⑤ 曲线推进中（引擎 undici+p-limit 施压内核，独立 BullMQ load 队列）", 7000);

  // 终态自动跳报告（或点查看报告）
  await page.waitForURL(/\/load\/reports\/[0-9a-f-]{36}/, { timeout: 40000 }).catch(async () => {
    const btn = page.getByTestId("load-goto-report");
    if (await btn.isVisible().catch(() => false)) await btn.click();
  });
  await step(page, "⑤ 压测报告：总请求/成功率/峰值 TPS/P95/P99 + RT 分位三线 + 阈值逐项判定", 5000);

  // ── ⑥ UI 测试：元素库建定位器 ──
  await page.goto(`${BASE}/ui-test/elements`);
  await step(page, "⑥ UI 测试 · 元素库：新建 3 个定位器（testid/css）", 2000);
  const createElement = async (name, locatorType, locator) => {
    await page.getByTestId("uit-element-create").click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ timeout: 8000 });
    await page.getByTestId("uit-element-name").locator("input").fill(name);
    await dialog.locator(".ant-select").first().click();
    const opt = page.locator(".ant-select-item-option").filter({ hasText: new RegExp(`^${locatorType}$`) }).first();
    await opt.waitFor({ timeout: 8000 });
    await opt.click();
    await page.getByTestId("uit-element-locator").locator("input").fill(locator);
    await page.getByRole("button", { name: /确 定|OK/ }).click();
    await page.getByTestId("uit-elements-table").filter({ hasText: name }).first().waitFor({ timeout: 8000 });
  };
  await createElement("演示-输入框", "testid", "demo-username");
  await createElement("演示-提交按钮", "testid", "demo-submit");
  await createElement("演示-结果文案", "css", ".demo-result-text");
  await step(page, "⑥ 元素库就绪（用户名输入框/提交按钮/结果文案）", 2000);

  // ── ⑦ UI 用例编排：4 步（goto→fill→click→assert）──
  await page.goto(`${BASE}/ui-test`);
  await page.getByTestId("uit-create-btn").click();
  await step(page, "⑦ 新建 UI 用例：对 mock /uit/demo 演示页编排 5 步", 2000);
  const caseName = `S11 演示-提交表单-${Date.now() % 100000}`;
  await page.getByRole("textbox", { name: "用例名称" }).fill(caseName);
  await page.getByPlaceholder("http(s) 绝对 URL").fill(`${MOCK}/uit/demo`);
  const addStep = async (opText, elementText, valueText, valuePlaceholder) => {
    await page.getByTestId("uit-add-step").click();
  };
  // 步骤 2：fill
  await addStep();
  await page.getByTestId("uit-step-op-1").locator(".ant-select").first().click();
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").last().getByText("fill（填写输入）").click();
  await page.getByTestId("uit-step-element-1").locator(".ant-select").first().click();
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").last().getByText(/演示-输入框/).first().click();
  await page.getByPlaceholder("填写值").fill("rabbit-demo");
  // 步骤 3：click
  await addStep();
  await page.getByTestId("uit-step-op-2").locator(".ant-select").first().click();
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").last().getByText("click（点击元素）").click();
  await page.getByTestId("uit-step-element-2").locator(".ant-select").first().click();
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").last().getByText(/演示-提交按钮/).first().click();
  // 步骤 4：assert-text
  await addStep();
  await page.getByTestId("uit-step-op-3").locator(".ant-select").first().click();
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").last().getByText("assert-text（断言文案）").click();
  await page.getByTestId("uit-step-element-3").locator(".ant-select").first().click();
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").last().getByText(/演示-结果文案/).first().click();
  await page.getByPlaceholder("期望包含的文案").fill("提交成功，rabbit-demo");
  // 步骤 5：screenshot
  await addStep();
  await page.getByTestId("uit-step-op-4").locator(".ant-select").first().click();
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").last().getByText("screenshot（截图）").click();
  await step(page, "⑦ 步骤序列：goto → fill(rabbit-demo) → click(提交) → assert-text → screenshot", 2400);
  await page.getByTestId("uit-save-btn").click();
  await page.waitForURL(/\/ui-test$/, { timeout: 10000 });
  await page.getByText(caseName).first().waitFor({ timeout: 8000 });

  // ── ⑧ 执行 chromium → 报告逐步截图 ──
  const caseRow = page.locator("tr", { hasText: caseName }).first();
  await caseRow.getByTestId(/^uit-run-/).click();
  await page.waitForURL(/\/ui-test\/tasks\/[0-9a-f-]{36}/, { timeout: 15000 });
  await step(page, "⑧ chromium 真执行中（引擎 playwright-core 驱动）…", 9000);
  await page.getByTestId("uit-report-status").getByText("SUCCESS").waitFor({ timeout: 90000 });
  await step(page, "⑧ 执行报告：步骤全 ✓ + 断言文案实值回显 + 截图网格（internal/files 落库）", 5000);

  // ── ⑨ 收尾：摘除 License → 回社区版占位 ──
  await api.delete(`${BASE}/api/v1/system/license`);
  await page.goto(`${BASE}/load`);
  await step(page, "⑨ 摘除 License → 回退占位页（社区版口径保持）", 2600);
  await page.goto(`${BASE}/ui-test`);
  await step(page, "S11 交付：性能测试 + UI 测试 · 企业版 License 门控 · 全绿收口", 3200);

  await ctx.close();
  await browser.close();
  // webm 落点：recordVideo 目录按 context 命名随机文件——重命名固定
  const fs = await import("node:fs");
  const files = fs.readdirSync(OUT).filter((f) => f.endsWith(".webm") && f !== "s11-acceptance-demo.webm");
  if (files.length > 0) {
    const newest = files.sort((a, b) => fs.statSync(path.join(OUT, b)).mtimeMs - fs.statSync(path.join(OUT, a)).mtimeMs)[0];
    fs.renameSync(path.join(OUT, newest), path.join(OUT, "s11-acceptance-demo.webm"));
    for (const f of files) {
      if (f !== newest) fs.rmSync(path.join(OUT, f), { force: true });
    }
  }
  console.log("[s11-demo] 录制完成：", path.join(OUT, "s11-acceptance-demo.webm"));
};

run().catch((e) => {
  console.error("[s11-demo] 录制失败：", e);
  process.exit(1);
});
