/**
 * 教学视频 2.4 缺陷管理 场景模块（分镜表 S3~S6 录屏镜；S1/S2/S7/S8 由 compose 管）。
 * 驱动：node scripts/tutor/record.mjs 2.4
 * 造数前置：node scripts/tutor/prep.mjs（演示缺陷 ×6：覆盖 待处理/处理中/已关闭 三态 + 用例关联）
 *
 * S3 新建「演示-教程缺陷」（批次口径：已存在则复用，不重创）；
 * S4 在该演示缺陷上做一次真实流转（每次录制至多推进一步，推完则以变更历史展示流转）；
 * S5 列表多维筛选（下拉展开为只读交互）；S6 缺陷 ↔ 用例双向追溯（走预置关联数据）。
 */
import { sleep } from "../../scripts/tutor/record-core.mjs";

const DEMO_BUG_TITLE = "演示-教程缺陷";
const LINKED_BUG_TITLE = "演示-登录页偶发500"; // prep.mjs：关联用例 演示-登录成功校验

function startNarrate(h, seg) {
  return h.narrate(seg);
}

async function settle(narrateP, sec, t0) {
  const d = await narrateP;
  const elapsed = (Date.now() - t0) / 1000;
  const need = Math.max(sec, d) - elapsed;
  if (need > 0) await sleep(need * 1000);
}

/** 在 /bugs 列表用关键字检索并打开缺陷详情；返回是否进入详情页。 */
async function openBugByTitle(page, h, title) {
  await h.goto("/bugs");
  await page
    .getByTestId("bug-table")
    .waitFor({ timeout: 15000 })
    .catch(() => {});
  const kw = page.getByTestId("input-bug-keyword");
  if (await kw.count()) {
    await kw.click({ timeout: 8000 }).catch(() => {});
    await kw.fill("");
    await page.keyboard.type(title, { delay: 20 });
    await page.keyboard.press("Enter");
    await sleep(1800);
  }
  const link = page.getByRole("link", { name: title });
  await link
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  if (!(await link.count())) return false;
  await link
    .first()
    .click({ timeout: 8000 })
    .catch(() => {});
  await page.waitForURL(/\/bugs\/[\w-]+/, { timeout: 12000 }).catch(() => {});
  await page
    .getByTestId("bug-status")
    .waitFor({ timeout: 12000 })
    .catch(() => {});
  return true;
}

export const scenes = [
  {
    seg: "S3",
    run: async (page, h) => {
      const t0 = Date.now();
      const narrateP = startNarrate(h, "S3");
      // /bugs 列表全景 → 关键字查重（存在则复用）→ 不存在走 /bugs/new 新建表单提交
      await h.goto("/bugs");
      await page
        .getByTestId("bug-table")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await sleep(900);
      await h.zoom('main [data-testid="bug-table"], main', 1.12, 700);

      const kw = page.getByTestId("input-bug-keyword");
      if (await kw.count()) {
        await h.spotlight('[data-testid="input-bug-keyword"]', 900).catch(() => {});
        await kw.click({ timeout: 8000 }).catch(() => {});
        await page.keyboard.type(DEMO_BUG_TITLE, { delay: 18 });
        await page.keyboard.press("Enter");
        await sleep(2000);
      }
      const existed = await page.getByRole("link", { name: DEMO_BUG_TITLE }).count();

      if (existed) {
        // 复用：直接打开已存在的演示缺陷详情
        await page
          .getByRole("link", { name: DEMO_BUG_TITLE })
          .first()
          .click({ timeout: 8000 })
          .catch(() => {});
        await page.waitForURL(/\/bugs\/[\w-]+/, { timeout: 12000 }).catch(() => {});
        await page
          .getByTestId("bug-status")
          .waitFor({ timeout: 12000 })
          .catch(() => {});
        await h.spotlight('[data-testid="bug-status"]', 1300).catch(() => {});
      } else {
        // 新建：标题 / 描述 / 处理人（MemberSelect）逐项拟真输入
        await page
          .getByTestId("btn-new-bug")
          .click({ timeout: 8000 })
          .catch(() => {});
        await page
          .getByTestId("bug-form")
          .waitFor({ timeout: 12000 })
          .catch(() => {});
        await sleep(800);
        await h.spotlight('[data-testid="input-bug-title"]', 1100).catch(() => {});
        await h.type('[data-testid="input-bug-title"]', DEMO_BUG_TITLE);
        await sleep(400);
        await h.type(
          '[data-testid="input-bug-description"]',
          "## 复现步骤\n1. 打开演示页面\n2. 提交表单\n\n**预期**：提交成功；**实际**：偶发无响应",
        );
        await sleep(400);
        // 处理人下拉（MemberSelect 无 testid：按「处理人」label 所在表单行定位 Select 根节点；
        // antd 的 placeholder 是 span 非 input[placeholder]，不能用 getByPlaceholder）
        const handler = page
          .locator('[data-testid="bug-form"] div.grid', {
            has: page.getByText("处理人", { exact: true }),
          })
          .locator(".ant-select")
          .first();
        if (await handler.count()) {
          await handler.click({ timeout: 8000 }).catch(() => {});
          const option = page
            .locator(".ant-select-dropdown:visible .ant-select-item-option")
            .first();
          const ok = await option
            .waitFor({ timeout: 8000 })
            .then(() => true)
            .catch(() => false);
          if (ok) {
            await option.click({ timeout: 5000 }).catch(() => {});
            await sleep(500);
          } else {
            await page.keyboard.press("Escape").catch(() => {});
          }
        }
        await h.spotlight('[data-testid="btn-submit-bug"]', 1000).catch(() => {});
        await page
          .getByTestId("btn-submit-bug")
          .click({ timeout: 8000 })
          .catch(() => {});
        // 保存后自动跳详情（BUG-001）
        await page.waitForURL(/\/bugs\/[\w-]+$/, { timeout: 15000 }).catch(() => {});
        await page
          .getByTestId("bug-status")
          .waitFor({ timeout: 12000 })
          .catch(() => {});
        await sleep(800);
        await h.spotlight('[data-testid="bug-status"]', 1500).catch(() => {});
      }
      await h.reset();
      await settle(narrateP, 40, t0);
    },
  },
  {
    seg: "S4",
    run: async (page, h) => {
      const t0 = Date.now();
      const narrateP = startNarrate(h, "S4");
      // 详情状态流转：待处理→处理中（或处理中→已关闭）真实推进一步；随后变更历史 Tab 展示全程留痕
      const opened = await openBugByTitle(page, h, DEMO_BUG_TITLE);
      if (opened) {
        await sleep(900);
        await h.spotlight('[data-testid="bug-status"]', 1300).catch(() => {});
        // 流转按钮组按 allowedTransitions 渲染：优先「处理中」，否则第一个可用目标
        const transBtns = page.locator('[data-testid^="btn-transition-"]');
        const prefer = page.getByTestId("btn-transition-处理中");
        const btn = (await prefer.count()) ? prefer : transBtns.first();
        if (await btn.count()) {
          await h.spotlight('button[data-testid^="btn-transition-"]', 1200).catch(() => {});
          await btn.click({ timeout: 8000 }).catch(() => {});
          await sleep(900);
          // 流转弹窗：填意见 → 确认流转
          const comment = page.getByTestId("input-transition-comment");
          if (await comment.count()) {
            await h.type(
              '[data-testid="input-transition-comment"]',
              "已定位根因，开始修复（演示流转）",
            );
            await sleep(300);
          }
          const confirm = page.getByRole("dialog").getByRole("button", { name: "确认流转" });
          if (await confirm.count()) {
            await confirm.click({ timeout: 8000 }).catch(() => {});
            await sleep(1800); // 状态徽标刷新
          } else {
            await page.keyboard.press("Escape").catch(() => {});
          }
          await h.spotlight('[data-testid="bug-status"]', 1500).catch(() => {});
        }
        // 变更历史：流转全程留痕（每步状态变化都有记录）
        const historyTab = page.getByTestId("tab-history");
        if (await historyTab.count()) {
          await historyTab.click({ timeout: 8000 }).catch(() => {});
          await sleep(1300);
          const timeline = page.getByTestId("change-timeline");
          if (await timeline.count()) {
            await h.panTo('[data-testid="change-timeline"]');
            await h.spotlight('[data-testid="change-timeline"]', 1800).catch(() => {});
          }
        }
        // 评论区（处理人/测试往返的载体）展示后回详情
        const commentsTab = page.getByTestId("tab-comments");
        if (await commentsTab.count()) {
          await commentsTab.click({ timeout: 8000 }).catch(() => {});
          await sleep(1200);
          await h.spotlight("main", 1200).catch(() => {});
        }
      }
      await h.reset();
      await settle(narrateP, 40, t0);
    },
  },
  {
    seg: "S5",
    run: async (page, h) => {
      const t0 = Date.now();
      const narrateP = startNarrate(h, "S5");
      // 列表多维筛选：状态 / 严重程度 / 标签（下拉展开均为只读交互，不改动数据）
      await h.goto("/bugs");
      await page
        .getByTestId("bug-table")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await sleep(900);

      // ① 状态筛选：待处理（演示数据含三态，筛出后行数肉眼可辨）
      const statusSel = page.getByTestId("select-bug-status");
      if (await statusSel.count()) {
        await h.spotlight('[data-testid="select-bug-status"]', 1100).catch(() => {});
        await statusSel.click({ timeout: 8000 }).catch(() => {});
        await sleep(800);
        const opt = page
          .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
          .getByText("待处理", { exact: true })
          .first();
        if (await opt.count()) await opt.click({ timeout: 5000 }).catch(() => {});
        await sleep(1600);
      }

      // ② 严重程度筛选：严重
      const sevSel = page.getByTestId("select-bug-severity");
      if (await sevSel.count()) {
        await h.spotlight('[data-testid="select-bug-severity"]', 1100).catch(() => {});
        await sevSel.click({ timeout: 8000 }).catch(() => {});
        await sleep(800);
        const opt = page
          .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
          .getByText("严重", { exact: true })
          .first();
        if (await opt.count()) await opt.click({ timeout: 5000 }).catch(() => {});
        await sleep(1600);
      }

      // ③ 标签筛选：演示（演示缺陷统一带「演示」标签）
      const tags = page.getByTestId("input-bug-tags");
      if (await tags.count()) {
        await h.spotlight('[data-testid="input-bug-tags"]', 1000).catch(() => {});
        await tags.click({ timeout: 8000 }).catch(() => {});
        await page.keyboard.type("演示", { delay: 30 });
        await page.keyboard.press("Enter");
        await sleep(1800);
      }
      await h.spotlight('main [data-testid="bug-table"], main table', 1500).catch(() => {});
      await h.reset();
      await settle(narrateP, 25, t0);
    },
  },
  {
    seg: "S6",
    run: async (page, h) => {
      const t0 = Date.now();
      const narrateP = startNarrate(h, "S6");
      // 双向追溯：缺陷 →「关联用例」Tab 跳用例详情 → 用例「缺陷」Tab 反向看到缺陷列表 → 跳回缺陷
      const opened = await openBugByTitle(page, h, LINKED_BUG_TITLE);
      if (opened) {
        await sleep(700);
        const casesTab = page.getByTestId("tab-cases");
        if (await casesTab.count()) {
          await casesTab.click({ timeout: 8000 }).catch(() => {});
          await sleep(1400);
          await h.spotlight("main", 1300).catch(() => {});
          // 缺陷 → 关联用例（点击 C-xxxx 链接跳用例详情）
          const caseLink = page.locator('main a[href^="/cases/"]').first();
          if (await caseLink.count()) {
            await caseLink.click({ timeout: 8000 }).catch(() => {});
            await page.waitForURL(/\/cases\/[\w-]+$/, { timeout: 12000 }).catch(() => {});
            await page
              .getByTestId("case-detail-tabs")
              .waitFor({ timeout: 15000 })
              .catch(() => {});
            await sleep(800);
            // 用例 → 反向关联缺陷列表（case-bug-table）
            const bugsTab = page.getByTestId("tab-bugs");
            if (await bugsTab.count()) {
              await bugsTab.click({ timeout: 8000 }).catch(() => {});
              await sleep(1400);
              const bugTable = page.getByTestId("case-bug-table");
              if (await bugTable.count()) {
                await h.panTo('[data-testid="case-bug-table"]');
                await h.spotlight('[data-testid="case-bug-table"]', 1600).catch(() => {});
              }
              // 闭环：从用例的缺陷列表跳回缺陷详情
              const backLink = page
                .locator('[data-testid="case-bug-table"] a[href^="/bugs/"]')
                .first();
              if (await backLink.count()) {
                await backLink.click({ timeout: 8000 }).catch(() => {});
                await page.waitForURL(/\/bugs\/[\w-]+/, { timeout: 12000 }).catch(() => {});
                await sleep(800);
                await h.spotlight('[data-testid="bug-status"]', 1200).catch(() => {});
              }
            }
          }
        }
      }
      await h.reset();
      await settle(narrateP, 20, t0);
    },
  },
];
