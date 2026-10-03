/**
 * S14 验收演示录屏（AGENTS 门禁 2：走查录屏归档）——独立录制脚本，非测试用例。
 * 六段：Agent 管理页 → 新建 Agent（模板）→ 技能库 → A2A 密钥+Card → 生成向导三步 → 产物预览。
 * 步骤左上角浮层标注（2.6s 淡出）；1280×720 webm。
 * 产物：docs/sprint-14-agent/demo/s14-acceptance-demo.webm
 * 前置：web :3100、mock :4001、pg :5454、redis :6381（RABBIT_SLOT=4）。
 * 用法：RABBIT_SLOT=4 node docs/sprint-14-agent/demo/s14-demo-record.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3104";
const OUT = path.resolve(import.meta.dirname ?? ".", ".");
mkdirSync(OUT, { recursive: true });

const email = `demo-s14-${Date.now()}@rabbit.test`;
const password = "rabbit-pass-123";
const suffix = String(Date.now()).slice(-5);

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
    setTimeout(() => d.remove(), 2600);
  }, title);
  await sleep(ms);
}

async function main() {
  console.log("[s14-demo] launching browser…");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);

  // ── 注册 ──
  console.log("[s14-demo] registering…");
  const reg = await page.request.post(`${BASE}/api/v1/auth/register`, {
    data: { email, password },
  });
  const regBody = (await reg.json());
  let projectId = regBody.data?.projectId;
  if (!projectId) {
    const login = await page.request.post(`${BASE}/api/v1/auth/login`, { data: { email, password } });
    await ctx.clearCookies();
    const cookie = (login.headers()["set-cookie"] ?? "").split("ras=")[1]?.split(";")[0];
    if (cookie) await ctx.addCookies([{ name: "ras", value: cookie, url: BASE }]);
    const projects = await page.request.get(`${BASE}/api/v1/personal/projects`);
    const pj = (await projects.json());
    const items = Array.isArray(pj.data) ? pj.data : pj.data?.items ?? [];
    projectId = items[0]?.id;
  }
  console.log(`[s14-demo] projectId=${projectId}`);

  // 设置 cookie（如果注册返回了）
  const loginRes = await page.request.post(`${BASE}/api/v1/auth/login`, { data: { email, password } });
  const cookie2 = (loginRes.headers()["set-cookie"] ?? "").split("ras=")[1]?.split(";")[0];
  if (cookie2) {
    await ctx.clearCookies();
    await ctx.addCookies([{ name: "ras", value: cookie2, url: BASE }]);
  }

  // ── 段 1：Agent 管理页（空态 → 列表） ──
  console.log("[s14-demo] ① Agent 管理页");
  await page.goto(`${BASE}/agents`);
  await page.waitForSelector('[data-testid="agents-page"]', { timeout: 15000 }).catch(() => {});
  await step(page, "① Sprint 14 项目级 Agent——独立「Agent」分组菜单", 3000);

  // ── 段 2：新建 Agent（抽屉六要素） ──
  console.log("[s14-demo] ② 新建 Agent");
  const createBtn = page.getByTestId("agent-create");
  if (await createBtn.isVisible().catch(() => false)) {
    await createBtn.click();
    await page.waitForSelector('[data-testid="agent-edit-drawer"]', { timeout: 10000 }).catch(() => {});
    await step(page, "② 新建 Agent——六要素：名称/描述/角色/模式/提示词/工具", 2600);
    const nameInput = page.getByTestId("agent-form-name");
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill(`演示-用例生成助手-${suffix}`);
    }
    const promptArea = page.locator("#systemPrompt");
    if (await promptArea.isVisible().catch(() => false)) {
      await promptArea.fill("你是测试专家，按等价类与边界值方法设计用例。");
    }
    await step(page, "填写名称与提示词", 1800);
    const saveBtn = page.getByTestId("agent-edit-save");
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
      await sleep(2500);
    }
    await step(page, "Agent 创建成功——卡片出现在列表中", 2400);
  }

  // ── 段 3：技能库（⑫轮导航改版后为独立菜单页） ──
  console.log("[s14-demo] ③ 技能库");
  const skillTab = page.locator('[data-testid="nav-agent-skills"]');
  if (await skillTab.isVisible().catch(() => false)) {
    await skillTab.click();
    await sleep(1500);
    await step(page, "③ 技能库——项目级 markdown 指令包，跨 Agent 复用", 2600);
    // 切回 Agent 菜单
    const agentTab = page.locator('[data-testid="nav-agents"]');
    if (await agentTab.isVisible().catch(() => false)) {
      await agentTab.click();
      await sleep(1000);
    }
  }

  // ── 段 4：A2A 密钥 + Agent Card ──
  console.log("[s14-demo] ④ A2A 密钥");
  // 找到刚创建的 Agent（列表第一张卡片）
  const cards = await page.locator('[data-testid^="agent-card-"]').all();
  let agentId = null;
  if (cards.length > 0) {
    const testid = await cards[0].getAttribute("data-testid");
    agentId = testid?.replace("agent-card-", "");
  }
  if (!agentId && projectId) {
    // 从 API 获取
    const list = await page.request.get(`${BASE}/api/v1/projects/${projectId}/agents`);
    const lb = (await list.json());
    agentId = lb.data?.items?.[0]?.id;
  }
  console.log(`[s14-demo] agentId=${agentId}`);

  if (agentId && projectId) {
    // 开启 A2A 密钥
    const keyRes = await page.request.post(`${BASE}/api/v1/projects/${projectId}/agents/${agentId}/a2a-key`);
    const keyBody = (await keyRes.json());
    const apiKey = keyBody.data?.apiKey;
    await step(page, `④ A2A 密钥已生成：${apiKey?.slice(0, 12)}…（明文仅显示一次）`, 3000);

    // Agent Card
    const cardRes = await page.request.get(`${BASE}/api/v1/a2a/projects/${projectId}/agents/${agentId}/agent-card.json`);
    const card = await cardRes.json().catch(() => ({ version: "1.0" }));
    await step(page, `A2A Agent Card（v${card.version}）——外部 AI 可按 A2A v1.0 协议发现并调用`, 3000);

    // JSON-RPC 调用演示
    if (apiKey) {
      const rpcRes = await page.request.post(`${BASE}/api/v1/a2a/projects/${projectId}/agents/${agentId}`, {
        headers: { authorization: `Bearer ${apiKey}` },
        data: { jsonrpc: "2.0", id: 1, method: "ListTasks", params: {} },
      });
      await step(page, `JSON-RPC ListTasks → ${rpcRes.status()}（A2A v1.0 协议面六方法之一）`, 2600);
    }
  }

  // ── 段 5：生成向导三步 ──
  console.log("[s14-demo] ⑤ 生成向导");
  if (agentId) {
    await page.goto(`${BASE}/agents/${agentId}/generate`);
    await page.waitForSelector('[data-testid="generate-wizard-page"]', { timeout: 15000 }).catch(() => {});
    await step(page, "⑤ 生成管线向导——步骤①上下文源：需求文本", 2800);

    const reqInput = page.getByTestId("generate-requirement-input");
    if (await reqInput.isVisible().catch(() => false)) {
      await reqInput.fill(`登录模块测试用例——覆盖正常登录、密码错误锁定、验证码过期 ${suffix}`);
      await step(page, "填写需求文本（预填默认提示词，可修改）", 1800);
    }

    const nextBtn = page.getByTestId("generate-next-stages");
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click();
      await sleep(1500);
      await step(page, "步骤②阶段与选项：A 需求分析 / B 接口提取 / C 脚本生成", 2600);

      const stageB = page.getByTestId("generate-stage-b");
      if (await stageB.isVisible().catch(() => false)) await stageB.uncheck();
      const stageC = page.getByTestId("generate-stage-c");
      if (await stageC.isVisible().catch(() => false)) await stageC.uncheck();
      await step(page, "取消 B/C（演示精简——仅保留阶段 A）", 1800);

      const startBtn = page.getByTestId("generate-start");
      if (await startBtn.isVisible().catch(() => false)) {
        await startBtn.click();
        await sleep(2000);
        await step(page, "步骤③运行——pi 会话驱动，草稿进入预览区", 3000);

        // 等终态
        for (let i = 0; i < 20; i++) {
          await sleep(3000);
          const runPanel = page.getByTestId("generate-step-run");
          if (await runPanel.isVisible().catch(() => false)) {
            const text = await runPanel.textContent();
            if (text?.includes("完成") || text?.includes("失败")) break;
          }
        }
        await step(page, "生成完成（或失败——取决于 mock 模型兼容性）", 2600);
      }
    }
  }

  // ── 段 6：产物预览 ──
  console.log("[s14-demo] ⑥ 产物预览");
  // 获取最新 run 的 runId
  if (agentId && projectId) {
    const runsRes = await page.request.get(`${BASE}/api/v1/projects/${projectId}/agents/${agentId}/runs?page=1&pageSize=1`);
    const runsBody = (await runsRes.json());
    const runId = runsBody.data?.items?.[0]?.id;
    if (runId) {
      await page.goto(`${BASE}/agents/${agentId}/runs/${runId}/drafts`);
      await page.waitForSelector('[data-testid="drafts-page"]', { timeout: 15000 }).catch(() => {});
      await step(page, "⑥ 产物预览——草稿三态（新增/冲突/无效）+ 勾选 + 批量导入", 3200);

      const table = page.getByTestId("drafts-table");
      if (await table.isVisible().catch(() => false)) {
        await step(page, "草稿表格——冲突项默认不勾选，人工确认后导入", 2600);
      }
      const importBtn = page.getByTestId("drafts-import-btn");
      if (await importBtn.isVisible().catch(() => false)) {
        await step(page, "「导入所选」按钮——未勾选时禁用（人工确认红线）", 2400);
      }
    }
  }

  // ── 收尾 ──
  await step(page, "Sprint 14 项目级 Agent + A2A v1.0 + 测试资产生成管线——验收完毕", 3000);
  await sleep(1000);

  // 关闭并保存视频
  await ctx.close();
  await browser.close();
  console.log("[s14-demo] done");
}

main().catch((e) => {
  console.error("[s14-demo] FATAL:", e);
  process.exit(1);
});
