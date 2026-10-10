/**
 * 教学视频 5.1 AI 助手 场景模块（分镜表 S3~S6 录屏镜；片头/AI/字卡/片尾由 compose 管）。
 * 驱动：node scripts/tutor/record.mjs 5.1
 * 造数口径：演示模型=「演示-教程模型」（baseUrl 指向本地 mock http://127.0.0.1:4000/ai，存在即复用；
 *  种子 e2e-mock-模型（RABBIT_SEED_AI_MOCK_BASE 注入时）已存在则直接复用不新建）。
 *
 * 与分镜表的已知差异（报告不改 docs）：
 *  - S5：按录制约束「不真的发对话」（mock 网关响应时长不可控）——开抽屉 + 输入问题 + 发送按钮特写，
 *        不点击发送；流式输出画面由 compose 侧素材或后续补录承担。
 */
import { sleep } from "../../scripts/tutor/record-core.mjs";

const DEMO_MODEL = "演示-教程模型";
const SEED_MODEL = "e2e-mock-模型";
const MOCK_AI = "http://127.0.0.1:4000/ai";

/** 末尾补足：录屏镜总时长 ≥ 分镜表时长。 */
async function pad(t0, sec) {
  const need = sec * 1000 - (Date.now() - t0);
  if (need > 0) await sleep(need);
}

export const scenes = [
  {
    seg: "S3", // 30s /system/ai-models：模型接入 + 连通性测试
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/system/ai-models");
      await sleep(1000);
      await h.narrate("S3");
      await page
        .getByTestId("ai-model-list")
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      const demo = page.getByTestId(`ai-model-card-${DEMO_MODEL}`);
      const seed = page.getByTestId(`ai-model-card-${SEED_MODEL}`);
      if (!(await demo.count()) && !(await seed.count())) {
        // 新建演示模型（指向本地 mock；AI-001 同口径表单）
        const create = page.getByTestId("ai-model-create");
        if (await create.count()) {
          await h.spotlight('[data-testid="ai-model-create"]', 900);
          await create.click();
          await sleep(800);
          await h.spotlight('[data-testid="ai-model-form-name"]', 800);
          await page.getByTestId("ai-model-form-name").fill(DEMO_MODEL);
          await page.getByTestId("ai-model-form-baseurl").fill(MOCK_AI);
          await page.getByTestId("ai-model-form-model").fill("mock-e2e-model");
          await page.getByTestId("ai-model-form-apikey").fill("placeholder-key"); // 演示 Key，真实密钥不入镜
          await sleep(600);
          await page
            .getByRole("dialog")
            .getByRole("button", { name: /确\s*定/ })
            .click()
            .catch(() => {});
          await sleep(1600);
        }
      }
      // 连通性测试（mock 秒回）
      const card = (await demo.count()) ? demo : seed;
      if (await card.count()) {
        const tid = await card.getAttribute("data-testid").catch(() => null);
        if (tid) await h.spotlight(`[data-testid="${tid}"]`, 1100);
        const testBtn = page.getByTestId(
          tid?.replace("ai-model-card-", "ai-model-test-") ?? "__none__",
        );
        if (await testBtn.count()) {
          await h.spotlight(
            `[data-testid="${tid.replace("ai-model-card-", "ai-model-test-")}"]`,
            800,
          );
          await testBtn.click().catch(() => {});
          await sleep(2600); // 测试中… → 结果提示
        }
      }
      await h.reset();
      await pad(t0, 30);
    },
  },
  {
    seg: "S4", // 20s /personal/ai-model：个人默认模型选择
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/personal/ai-model");
      await sleep(1000);
      await h.narrate("S4");
      await page
        .getByTestId("page-personal-ai-model")
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      const opts = page.locator('[data-testid^="personal-model-"]');
      const n = await opts.count();
      if (n > 0) {
        await h.spotlight('[data-testid="personal-ai-model-group"]', 1000);
        const tid = await opts
          .nth(n - 1)
          .getAttribute("data-testid")
          .catch(() => null);
        if (tid) {
          await h.spotlight(`[data-testid="${tid}"]`, 900);
          await page
            .getByTestId(tid)
            .click()
            .catch(() => {});
          await sleep(700);
        }
        const save = page.getByTestId("personal-ai-model-save");
        if (await save.count()) {
          await h.spotlight('[data-testid="personal-ai-model-save"]', 800);
          await save.click().catch(() => {});
          await sleep(1100);
        }
      } else {
        // 无可用模型（种子未注入 mock）：空态展示
        await h.spotlight('[data-testid="page-personal-ai-model"]', 1500);
      }
      await pad(t0, 20);
    },
  },
  {
    seg: "S5", // 45s AI 助手抽屉：开抽屉 + 会话列表 + 输入问题（不发送）
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/");
      await sleep(1000);
      await h.narrate("S5");
      await h.spotlight('[data-testid="topbar-ai-assistant"]', 1200);
      await page.getByTestId("topbar-ai-assistant").click();
      await page
        .getByTestId("ai-assistant-drawer")
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      await sleep(900);
      await h.zoom('[data-testid="ai-assistant-drawer"]', 1.05, 500).catch(() => {});
      await sleep(600);
      // 历史会话列表浏览
      const list = page.getByTestId("ai-conversation-list");
      if (await list.count()) {
        await h.spotlight('[data-testid="ai-conversation-list"]', 1000);
      }
      // 输入框聚焦 + 键入问题（不点击发送——mock 模型响应时长不可控）
      const input = page.getByTestId("ai-chat-input");
      if (await input.count()) {
        await input.click();
        await sleep(400);
        await h.spotlight('[data-testid="ai-chat-input"]', 900);
        await page.keyboard.type("写一个登录接口的断言思路", { delay: 55 });
        await sleep(700);
        await h.spotlight('[data-testid="ai-chat-send"]', 900);
        await sleep(600);
      }
      await page.keyboard.press("Escape"); // 关抽屉
      await sleep(600);
      await pad(t0, 45);
    },
  },
  {
    seg: "S6", // 25s 会话管理：历史会话 + 新建会话
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/");
      await sleep(800);
      await h.narrate("S6");
      await page.getByTestId("topbar-ai-assistant").click();
      await page
        .getByTestId("ai-assistant-drawer")
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      await sleep(900);
      const list = page.getByTestId("ai-conversation-list");
      if (await list.count()) {
        await h.spotlight('[data-testid="ai-conversation-list"]', 1200);
        // 回到某一旧会话（第二条优先，回退第一条）
        const items = list.locator("li");
        const byDiv = list.locator(":scope > *");
        const target = (await items.count()) > 1 ? items.nth(1) : byDiv.nth(0);
        if (await target.count()) await target.click().catch(() => {});
        await sleep(1100);
      }
      // 新建会话
      const newBtn = page.getByTestId("ai-new-conversation");
      if (await newBtn.count()) {
        await h.spotlight('[data-testid="ai-new-conversation"]', 900);
        await newBtn.click().catch(() => {});
        await sleep(1100);
      }
      await page.keyboard.press("Escape");
      await sleep(500);
      await pad(t0, 25);
    },
  },
];
