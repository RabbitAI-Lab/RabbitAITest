/**
 * 教学视频 2.3 用例评审 场景模块（分镜表 S3~S6 录屏镜；S1/S2/S7/S8 由 compose 管）。
 * 驱动：node scripts/tutor/record.mjs 2.3
 * 造数前置：node scripts/tutor/prep.mjs（预置评审「演示-登录模块用例评审」：3 条用例全部 PASS 后已结束）
 *
 * 本集按批次口径执行「只读浏览 + 展开」：不真实改动预置评审数据——
 * S3 只展示新建评审弹窗的字段布局后取消；S4 在预置评审详情内逐条浏览/开评审历史弹窗；
 * S5 以用例详情「用例评审」Tab 展示评审结论回流（预置评审全部通过，无驳回二态，见交付报告）。
 */
import { sleep } from "../../scripts/tutor/record-core.mjs";

const REVIEW_NAME = "演示-登录模块用例评审";

function startNarrate(h, seg) {
  return h.narrate(seg);
}

async function settle(narrateP, sec, t0) {
  const d = await narrateP;
  const elapsed = (Date.now() - t0) / 1000;
  const need = Math.max(sec, d) - elapsed;
  if (need > 0) await sleep(need * 1000);
}

/** 关闭 antd Modal（取消按钮 → 右上 X → Escape 三级兜底；不触发任何提交） */
async function closeModal(page) {
  const cancel = page.getByRole("dialog").getByRole("button", { name: /^取\s*消$/ });
  if (await cancel.count()) {
    await cancel
      .first()
      .click({ timeout: 5000 })
      .catch(() => {});
    await sleep(500);
    return;
  }
  const x = page.locator(".ant-modal .ant-modal-close").first();
  if (await x.count()) {
    await x.click({ timeout: 5000 }).catch(() => {});
    await sleep(500);
    return;
  }
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(400);
}

export const scenes = [
  {
    seg: "S3",
    run: async (page, h) => {
      const t0 = Date.now();
      const narrateP = startNarrate(h, "S3");
      // /reviews 列表全景 → 演示评审行（通过率进度条）→ 新建评审弹窗字段布局（只读，不提交）
      await h.goto("/reviews");
      await page
        .getByTestId("input-review-keyword")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await page
        .getByTestId("review-row")
        .first()
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await sleep(1000);
      const demoRow = page.locator("tr", { hasText: REVIEW_NAME });
      if (await demoRow.count()) {
        await h.spotlight("main table", 1500).catch(() => {});
        await sleep(500);
      }
      const newBtn = page.getByTestId("btn-new-review");
      if (await newBtn.count()) {
        await newBtn.click({ timeout: 8000 }).catch(() => {});
        await sleep(900);
        // 弹窗内逐项：名称 / 模式 / 评审人 / 起止时间（分镜口径的「圈选用例」在详情页完成，弹窗无此项）
        await h.spotlight('[data-testid="input-review-name"]', 1400).catch(() => {});
        await h.spotlight('[data-testid="select-review-mode"]', 1200).catch(() => {});
        await h.spotlight('[data-testid="select-reviewers"]', 1400).catch(() => {});
        await h.spotlight('[data-testid="input-review-range"]', 1200).catch(() => {});
        await sleep(600);
        await closeModal(page); // 不创建：仅展示表单后取消
      }
      await h.reset();
      await settle(narrateP, 35, t0);
    },
  },
  {
    seg: "S4",
    run: async (page, h) => {
      const t0 = Date.now();
      const narrateP = startNarrate(h, "S4");
      // 进入预置评审详情：左侧清单逐条点选 → 右侧速览（前置条件/步骤）→ 状态筛选/自动下一条 → 评审历史弹窗
      await h.goto("/reviews");
      const link = page.getByRole("link", { name: REVIEW_NAME });
      await link
        .first()
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      if (await link.count()) {
        await link
          .first()
          .click({ timeout: 8000 })
          .catch(() => {});
        await page.waitForURL(/\/reviews\/[\w-]+/, { timeout: 12000 }).catch(() => {});
      }
      await page
        .getByTestId("review-case-list")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await sleep(1000);
      // 通过率环 + 状态徽标（预置评审已结束：结论留痕）
      await h.zoom("main", 1.12, 700);
      await h.spotlight('[data-testid="review-circle"]', 1500).catch(() => {});
      // 左侧清单逐条浏览（点选 → 右侧速览切换；首条展开步骤折叠面板节奏放慢）
      const items = page.locator('[data-testid^="review-case-item-"]');
      const total = await items.count().catch(() => 0);
      for (let i = 0; i < Math.min(total, 3); i++) {
        const item = items.nth(i);
        await item.click({ timeout: 8000 }).catch(() => {});
        await sleep(1600);
        if (i === 0) {
          await h.spotlight('[data-testid="review-case-list"]', 1400).catch(() => {});
          // 步骤折叠面板默认展开；如被折叠则点开（「展开」口径）
          const collapseHeader = page.locator(".ant-collapse-header", { hasText: "步骤" }).first();
          const expanded = await page
            .locator(".ant-collapse-item-active .ant-collapse-header")
            .count()
            .catch(() => 0);
          if (!expanded && (await collapseHeader.count())) {
            await collapseHeader.click({ timeout: 5000 }).catch(() => {});
            await sleep(900);
          }
        }
      }
      // 状态筛选 + 自动下一条（评审人工作台的两个效率件）
      await h.spotlight('[data-testid="review-filter-result"]', 1300).catch(() => {});
      await h.spotlight('[data-testid="switch-auto-next"]', 1200).catch(() => {});
      // 评审历史弹窗：当前用例的标记时间线（每条结论留痕），只读展示后关闭
      const historyBtn = page.getByTestId("btn-review-history");
      if (await historyBtn.count()) {
        await historyBtn.click({ timeout: 8000 }).catch(() => {});
        await sleep(1200);
        await h.spotlight('[data-testid="review-history"]', 1600).catch(() => {});
        await sleep(600);
        await closeModal(page);
      }
      await h.reset();
      await settle(narrateP, 50, t0);
    },
  },
  {
    seg: "S5",
    run: async (page, h) => {
      const t0 = Date.now();
      const narrateP = startNarrate(h, "S5");
      // 评审结论回流到用例：/cases 检索被评审用例 → 详情「用例评审」Tab（case-review-table 展示结论）
      await h.goto("/cases");
      await page
        .getByTestId("case-table")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      const kw = page.getByTestId("input-keyword");
      if (await kw.count()) {
        await h.spotlight('[data-testid="input-keyword"]', 1000).catch(() => {});
        await h.type('[data-testid="input-keyword"]', "演示-登录成功校验");
        await sleep(300);
        await page.keyboard.press("Enter");
        await sleep(1500);
      }
      const row = page.getByRole("row", { name: /演示-登录成功校验/ });
      await row.waitFor({ timeout: 12000 }).catch(() => {});
      await h.spotlight('main [data-testid="case-table"]', 1400).catch(() => {});
      const numLink = row.getByRole("link", { name: /^C-\d{4,}$/ });
      if (await numLink.count()) {
        await numLink.click({ timeout: 8000 }).catch(() => {});
        await page.waitForURL(/\/cases\/[\w-]+$/, { timeout: 12000 }).catch(() => {});
      }
      const tabs = page.getByTestId("case-detail-tabs");
      await tabs.waitFor({ timeout: 15000 }).catch(() => {});
      const reviewTab = page.getByTestId("tab-reviews");
      if (await reviewTab.count()) {
        await reviewTab.click({ timeout: 8000 }).catch(() => {});
        await sleep(1300);
        const table = page.getByTestId("case-review-table");
        if (await table.count()) {
          await h.panTo('[data-testid="case-review-table"]');
          await h.spotlight('[data-testid="case-review-table"]', 1800).catch(() => {});
        }
      }
      await h.reset();
      await settle(narrateP, 30, t0);
    },
  },
  {
    seg: "S6",
    run: async (page, h) => {
      const t0 = Date.now();
      const narrateP = startNarrate(h, "S6");
      // 消息中心：评审分配/结论以站内消息触达（铃铛下拉，同 1.1 S8 口径）
      await h.goto("/");
      await sleep(900);
      const bell = page.getByTestId("header-bell");
      if (await bell.count()) {
        await h.spotlight('[data-testid="header-bell"]', 1200).catch(() => {});
        await bell.click({ timeout: 8000 }).catch(() => {});
        await sleep(1200);
        await h.spotlight('[data-testid="bell-dropdown"]', 1500).catch(() => {});
        await sleep(800);
        await page.keyboard.press("Escape").catch(() => {});
        await sleep(400);
      }
      await settle(narrateP, 20, t0);
    },
  },
];
