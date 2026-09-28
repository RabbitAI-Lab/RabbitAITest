/**
 * S5 验收演示录屏（AGENTS 门禁 2：走查录屏归档）——独立录制脚本，非测试用例。
 * 走 sprint-overview §1 演示主线；步骤左上角浮层标注（2.6s 淡出）；1280×720 webm。
 * 产物：docs/sprint-5-collaboration/demo/s5-acceptance-demo.webm
 * 前置：web :3100（含 OUTBOUND_ALLOW_PRIVATE=1）、mock :4001、pg :5434、redis :6381。
 * 用法：node tests/demo/s5-demo-record.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3100";
const MOCK = process.env.DEMO_MOCK_URL ?? "http://127.0.0.1:4001";
const OUT = path.resolve(import.meta.dirname ?? ".", "../../docs/sprint-5-collaboration/demo");
mkdirSync(OUT, { recursive: true });

const email = `demo-s5-${Date.now()}@rabbit.test`;
const password = "rabbit-pass-123";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(page, title, ms = 2400) {
  // 左上角步骤标注浮层（录屏可读性）
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

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
  });
  const page = await ctx.newPage();
  const api = ctx.request;

  // ── 0 注册（演示用户）──
  await page.goto(`${BASE}/register`);
  await step(page, "S5 验收演示 · 注册演示用户", 1800);
  const reg = await api.post(`${BASE}/api/v1/auth/register`, { data: { email, password } });
  const { data: regBody } = await reg.json();
  const cookie = (reg.headers()["set-cookie"] ?? "").split("ras=")[1]?.split(";")[0];
  await ctx.addCookies([{ name: "ras", value: cookie, url: BASE }]);
  const projectId = regBody.projectId;

  // ── 1 消息管理：机器人 + 测试发送 + 事件配置 ──
  await page.goto(`${BASE}/settings/messages`);
  await step(page, "① 项目设置 → 消息管理：新建钉钉机器人（webhook 指向演示 mock）", 1600);
  await page.getByTestId("btn-new-robot").click();
  await page.getByTestId("robot-name-input").fill("验收演示-钉钉机器人");
  await page.getByTestId("robot-channel-select").click();
  await page.getByTitle("钉钉", { exact: false }).first().click();
  await page.getByTestId("robot-webhook-input").fill(`${MOCK}/mock-robot/dingtalk`);
  await page.getByRole("button", { name: "确 定" }).click();
  await sleep(1200);
  await step(page, "机器人「测试」：webhook 实投 → 演示 mock 收包", 1600);
  await page.getByTestId("robot-test-验收演示-钉钉机器人").click();
  await sleep(1800);
  await step(page, "事件配置：开启 BUG_CREATED（接收人=操作人自己 + 站内信渠道）", 1600);
  await page.getByRole("tab", { name: "事件配置" }).click();
  const bugRow = page.getByTestId("event-row-BUG_CREATED");
  await bugRow.getByRole("switch").click();
  await sleep(600);
  await bugRow.locator(".ant-select").first().click();
  await page.keyboard.press("ArrowDown"); // antd 虚拟列表 option 不直接可见——键盘选择（同 PROJ-006 e2e 教训）
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await bugRow.locator(".ant-select").last().click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "保存事件配置" }).click();
  await sleep(1500);

  // ── 2 建缺陷（触发通知）→ 铃铛 ──
  await page.goto(`${BASE}/bugs`);
  await step(page, "② 缺陷管理：新建缺陷（触发 BUG_CREATED 通知）", 1600);
  await page.getByTestId("btn-new-bug").click();
  await sleep(1200);
  const api2 = ctx.request;
  const bug = await (async () => {
    const r = await api2.post(`${BASE}/api/v1/projects/${projectId}/bugs`, {
      data: { title: "验收演示：登录页偶发 500" },
    });
    return (await r.json()).data;
  })();
  await page.goto(`${BASE}/bugs`);
  await sleep(1200);
  await step(page, "顶栏铃铛：操作人去重（建缺陷人不收）· mock 机器人已收 webhook", 2200);
  await page.getByTestId("header-bell").click();
  await sleep(2200);
  await page.keyboard.press("Escape");

  // ── 3 回收站批量 ──
  await step(page, "③ 回收站：删除 → 批量恢复 → 彻底删除", 1600);
  await api2.delete(`${BASE}/api/v1/projects/${projectId}/bugs/${bug.id}`);
  await page.getByTestId("tab-recycle").click();
  await sleep(1500);
  await page
    .getByRole("row", { name: /验收演示/ })
    .getByRole("checkbox")
    .check();
  await page.getByTestId("btn-batch-restore-bugs").click();
  await sleep(1800);

  // ── 4 公共脚本 ──
  await page.goto(`${BASE}/settings/public-scripts`);
  await step(page, "④ 公共脚本：新建（参数 length 默认 8）", 1600);
  const script = await (async () => {
    const r = await api2.post(`${BASE}/api/v1/projects/${projectId}/public-scripts`, {
      data: {
        name: "验收-生成登录凭证",
        language: "javascript",
        tags: ["验收"],
        params: [{ name: "length", defaultValue: "8", required: true }],
        content:
          'const n = Number(getVar("param.length")||"8"); setVar("loginUser","u"+randomInt(1000,9999)); log("n="+n);',
      },
    });
    return (await r.json()).data;
  })();
  await page.reload();
  await sleep(1200);
  await step(page, "在线调试：参数覆盖 length=6 → 控制台输出 n=6", 1800);
  await page.getByTestId("script-debug-验收-生成登录凭证").click();
  await sleep(1200);
  await page.locator(".ant-drawer").last().getByRole("textbox").nth(1).fill('{"length":"6"}');
  await page.getByTestId("script-debug-run").click();
  await sleep(2200);
  await page.keyboard.press("Escape");
  await sleep(500);
  await step(page, "发布（DRAFT → 已发布，可被前后置引用）", 1600);
  await page.getByRole("button", { name: "发布" }).first().click({ force: true });
  await sleep(1800);

  // ── 5 环境组与全局参数 ──
  await page.goto(`${BASE}/settings/environments`);
  await step(page, "⑤ 环境管理：全局参数（项目级兜底变量域）", 1600);
  await page.getByRole("tab", { name: "全局参数" }).click();
  await sleep(1200);
  await page.getByTestId("btn-add-global-param").click(); // 空态无行——先添加参数行
  await sleep(600);
  const gpInputs = page.getByRole("tabpanel", { name: "全局参数" }).getByRole("textbox");
  await gpInputs.nth(0).fill("app.host");
  await gpInputs.nth(1).fill("https://sit.example.com");
  await page.getByTestId("btn-save-global-params").click();
  await sleep(1500);
  await step(page, "环境组：新建组（sit → uat 按序执行）", 1600);
  await page.getByRole("tab", { name: "环境组" }).click();
  await sleep(1200);
  const envIds = await (async () => {
    const a = await api2.post(`${BASE}/api/v1/projects/${projectId}/environments`, {
      data: { name: "sit", config: {} },
    });
    const b = await api2.post(`${BASE}/api/v1/projects/${projectId}/environments`, {
      data: { name: "uat", config: {} },
    });
    return [(await a.json()).data.id, (await b.json()).data.id];
  })();
  await api2.post(`${BASE}/api/v1/projects/${projectId}/env-groups`, {
    data: { name: "验收-回归组", environmentIds: envIds },
  });
  await page.reload();
  await page.getByRole("tab", { name: "环境组" }).click();
  await sleep(1800);

  // ── 6 Git 仓库文件 ──
  await page.goto(`${BASE}/files`);
  await step(page, "⑥ 文件管理：连接 Git 存储库（gitea → 演示 mock，Token 加密）", 1600);
  await page.getByTestId("btn-file-repos").click();
  await sleep(800);
  await page.getByTestId("btn-new-file-repo").click();
  await page.getByTestId("repo-url-input").fill(`${MOCK}/qa/testdata`);
  await page.getByTestId("repo-token-input").fill("demo-token");
  await page.getByRole("button", { name: "确 定" }).last().click();
  await sleep(1500);
  const repo = await (async () => {
    const r = await api2.get(`${BASE}/api/v1/projects/${projectId}/file-repos`);
    return (await r.json()).data.items[0];
  })();
  await step(page, "连接测试 → 按分支+路径拉取（data/ 目录）", 1600);
  await page.getByTestId(`repo-pull-${repo.id}`).click();
  await page.getByTestId("repo-pull-branch").fill("main");
  await page.getByTestId("repo-pull-path").fill("data/");
  await page.getByRole("button", { name: "确 定" }).last().click();
  await sleep(2000);
  await page.keyboard.press("Escape");
  await sleep(800);
  await step(page, "文件列表：Gitea 来源徽标 + 分支/路径溯源", 2400);
  await page.reload();
  await sleep(2000);

  // ── 7 个人中心 ──
  await page.goto(`${BASE}/personal`);
  await step(page, "⑦ 个人中心：个人信息（邮箱=登录名不可改；姓名/手机可编辑）", 2200);
  await page.getByTestId("personal-menu-local-runner").click();
  await step(page, "本地执行：环回地址连通检测 + 优先本地开关", 1600);
  await page.getByTestId("local-runner-address").fill(`${MOCK}/healthz`);
  await page.getByTestId("local-runner-save").click();
  await sleep(1000);
  await page.getByTestId("local-runner-check").click();
  await sleep(2200);
  await page.getByTestId("personal-menu-ai-model").click();
  await step(page, "模型设置：个人默认模型（优先于系统默认，AI 助手/生成生效）", 2200);
  await page
    .locator('[data-testid^="personal-model-"] input[type="radio"]')
    .first()
    .check({ timeout: 15_000 })
    .catch(() => {});
  await page
    .getByTestId("personal-ai-model-save")
    .click({ force: true })
    .catch(() => {});
  await sleep(1800);

  // ── 8 AI 助手（个人模型）──
  await page.goto(`${BASE}/`);
  await step(page, "⑧ 工作台 → AI 助手（走个人默认模型的演示 mock）", 1600);
  await page.getByTestId("topbar-ai-assistant").click();
  await sleep(1500);
  await page
    .getByPlaceholder(/输入|提问/, { exact: false })
    .first()
    .fill("用一句话设计登录密码错误的测试点")
    .catch(() => {});
  await page.keyboard.press("Enter").catch(() => {});
  await sleep(3500);

  await step(
    page,
    "S5 验收演示结束 —— 六功能：通知机器人/缺陷协作/公共脚本/环境组/Git 仓库/个人中心",
    3000,
  );

  await ctx.close();
  await browser.close();
  console.log(`[demo] video → ${OUT}/s5-acceptance-demo.webm（重命名为固定名见脚本头部注释）`);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
