/**
 * 教学视频 5.2 AI 生成用例 场景模块（分镜表 S3~S6 录屏镜；片头/AI/字卡/片尾由 compose 管）。
 * 驱动：node scripts/tutor/record.mjs 5.2
 * 造数口径：演示提示词模板=「演示-教程模板」（/settings/ai-prompts，存在即复用）；
 *  需求文本=购物车优惠券规则（分镜「录制数据准备」口径）。
 *
 * 与分镜表的已知差异（报告不改 docs）：
 *  - S4：「采纳 2 条/编辑后采纳/丢弃 1 条」会真实落库用例（mock 草稿名固定、无「演示-」前缀）——
 *        演示止步于草稿审阅 + 勾选切换 + 导入按钮特写，不点击导入（人是决策者，审后再用）。
 *  - S5：接口用例生成同样不真实提交（契约引用 + 断言建议入口特写为主）。
 *  - S7「生成记录页」在 UI 不存在（/api/v1/projects/{pid}/ai/gen-records 仅接口，web 无页面）——
 *        该镜未实现，需 compose 侧以字卡/口播替代或后续补页面。
 */
import { sleep } from "../../scripts/tutor/record-core.mjs";

const DEMO_PROMPT = "演示-教程模板";
const REQUIREMENT =
  "购物车优惠券规则：满 200 减 30，每单限用一张，券不可叠加；下单后 15 分钟未支付订单自动取消并退还优惠券；退还的券在有效期内核算剩余天数。";

/** 末尾补足：录屏镜总时长 ≥ 分镜表时长。 */
async function pad(t0, sec) {
  const need = sec * 1000 - (Date.now() - t0);
  if (need > 0) await sleep(need);
}

/** 打开用例生成抽屉并填入需求文本（成功 true）。 */
async function openCaseDrawer(page, h) {
  const btn = page.getByTestId("btn-ai-generate");
  if (!(await btn.count())) return false;
  await btn.click();
  await page
    .getByTestId("ai-case-generate-drawer")
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  await sleep(700);
  const req = page.getByTestId("ai-case-requirement");
  if (await req.count()) {
    await req.click().catch(() => {});
    await page.keyboard.type(REQUIREMENT, { delay: 14 });
    await sleep(400);
  }
  return true;
}

export const scenes = [
  {
    seg: "S3", // 45s 功能用例生成入口：粘贴需求 → 数量/模板 → 生成按钮特写（发起留给 S4）
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/cases");
      await sleep(1000);
      await h.narrate("S3");
      await page
        .getByTestId("case-table")
        .waitFor({ timeout: 12000 })
        .catch(() => {});
      const btn = page.getByTestId("btn-ai-generate");
      if (await btn.count()) {
        await h.spotlight('[data-testid="btn-ai-generate"]', 1200);
        if (await openCaseDrawer(page, h)) {
          const req = page.getByTestId("ai-case-requirement");
          if (await req.count()) await h.spotlight('[data-testid="ai-case-requirement"]', 1000);
          // 模板选择（提示词模板影响生成风格，呼应 S6）
          const tpl = page.getByTestId("ai-case-template");
          if (await tpl.count()) {
            await h.spotlight('[data-testid="ai-case-template"]', 1000);
            await sleep(600);
          }
          await h.spotlight('[data-testid="ai-case-generate"]', 1000);
          await sleep(600);
        }
      }
      await pad(t0, 45);
    },
  },
  {
    seg: "S4", // 30s 发起生成（mock 确定性秒回）→ 草稿逐条审阅 + 勾选切换（不导入落库）
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/cases");
      await sleep(900);
      await h.narrate("S4");
      const btn = page.getByTestId("btn-ai-generate");
      if (!(await btn.count())) {
        await pad(t0, 30);
        return;
      }
      if (await openCaseDrawer(page, h)) {
        const gen = page.getByTestId("ai-case-generate");
        let ok = false;
        if (await gen.count()) {
          try {
            const wait = page.waitForResponse((r) => r.url().includes("/ai/generate/cases"), {
              timeout: 15000,
            });
            await gen.click();
            const res = await wait;
            ok = res.ok();
          } catch {
            ok = false; // 模型缺失/慢网关：降级浏览抽屉
          }
        }
        if (ok) {
          await page
            .getByTestId("ai-case-draft-0")
            .waitFor({ timeout: 15000 })
            .catch(() => {});
          const d0 = page.getByTestId("ai-case-draft-0");
          if (await d0.count()) {
            await h.spotlight('[data-testid="ai-case-draft-0"]', 1300);
            const d1 = page.getByTestId("ai-case-draft-1");
            if (await d1.count()) {
              await h.spotlight('[data-testid="ai-case-draft-1"]', 1000);
              // 勾选切换 = 审阅决策（丢弃该条）
              await d1
                .locator("input[type=checkbox]")
                .click()
                .catch(() => {});
              await sleep(700);
            }
            // 导入按钮特写：审后再用（演示不落库）
            const imp = page.getByTestId("ai-case-import");
            if (await imp.count()) await h.spotlight('[data-testid="ai-case-import"]', 1100);
          }
        } else {
          await h.zoom('[data-testid="ai-case-generate-drawer"]', 1.05, 500).catch(() => {});
          await sleep(2200);
        }
      }
      await pad(t0, 30);
    },
  },
  {
    seg: "S5", // 40s 接口用例生成：接口定义行入口 → 契约引用 + 生成入口（不真实提交）
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/apis");
      await sleep(1000);
      await h.narrate("S5");
      // 找第一行的 AI 生成入口（btn-ai-gen-api-{i}，AI-003 口径）
      let btn = null;
      for (let i = 1; i <= 5; i++) {
        const b = page.getByTestId(`btn-ai-gen-api-${i}`);
        if (await b.count()) {
          btn = b;
          break;
        }
      }
      if (btn) {
        const tid = await btn.getAttribute("data-testid").catch(() => null);
        if (tid) await h.spotlight(`[data-testid="${tid}"]`, 1000);
        await btn.click();
        await page
          .getByTestId("ai-apicase-drawer")
          .waitFor({ timeout: 10000 })
          .catch(() => {});
        await sleep(1000);
        // 契约引用区（目标接口信息）+ 参数组合/断言建议入口
        await h.zoom('[data-testid="ai-apicase-drawer"]', 1.06, 600).catch(() => {});
        await sleep(1400);
        const oa = page.getByTestId("ai-apicase-openapi");
        if (await oa.count()) {
          await h.spotlight('[data-testid="ai-apicase-openapi"]', 1000);
          await sleep(500);
        }
        const genBtn = page.getByTestId("ai-apicase-generate");
        if (await genBtn.count()) {
          await h.spotlight('[data-testid="ai-apicase-generate"]', 900);
          await sleep(500);
        }
      } else {
        // 无接口定义兜底：接口列表全景
        await h.spotlight("main", 1500).catch(() => {});
        await sleep(1600);
      }
      await pad(t0, 40);
    },
  },
  {
    seg: "S6", // 30s /settings/ai-prompts：模板列表 → 新建演示模板（加风格约束）→ 生成抽屉模板下拉呼应
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/settings/ai-prompts");
      await sleep(1000);
      await h.narrate("S6");
      await page
        .getByTestId("ai-prompt-table")
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      // 行/空态落定后再判断复用（防异步加载竞态误新建）
      await page
        .locator('[data-testid^="ai-prompt-row-"], [data-testid="ai-prompt-empty"]')
        .first()
        .waitFor({ timeout: 8000 })
        .catch(() => {});
      await h.spotlight('[data-testid="ai-prompt-table"]', 1000);
      if (!(await page.getByTestId(`ai-prompt-row-${DEMO_PROMPT}`).count())) {
        const create = page.getByTestId("ai-prompt-create");
        if (await create.count()) {
          await h.spotlight('[data-testid="ai-prompt-create"]', 800);
          await create.click();
          await sleep(800);
          await h.spotlight('[data-testid="ai-prompt-form-template"]', 900);
          await page.getByTestId("ai-prompt-form-name").fill(DEMO_PROMPT);
          await page
            .getByTestId("ai-prompt-form-template")
            .fill("按 {{requirement}} 生成用例；风格约束：步骤一律「动作-数据-预期」三段式");
          await page.getByTestId("ai-prompt-form-design").fill("场景法 + 边界值");
          await sleep(600);
          await page
            .getByTestId("ai-prompt-save")
            .click()
            .catch(() => {});
          await sleep(1400);
        }
      }
      const row = page.getByTestId(`ai-prompt-row-${DEMO_PROMPT}`);
      if (await row.count()) {
        await h.spotlight(`[data-testid="ai-prompt-row-${DEMO_PROMPT}"]`, 1000);
      }
      // 回到生成抽屉：模板下拉已含新模板（定制生效的呼应画面）
      await h.goto("/cases");
      await sleep(900);
      const btn = page.getByTestId("btn-ai-generate");
      if (await btn.count()) {
        await btn.click();
        await page
          .getByTestId("ai-case-generate-drawer")
          .waitFor({ timeout: 10000 })
          .catch(() => {});
        await sleep(800);
        const tpl = page.getByTestId("ai-case-template");
        if (await tpl.count()) await h.spotlight('[data-testid="ai-case-template"]', 1300);
      }
      await h.reset();
      await pad(t0, 30);
    },
  },
];
