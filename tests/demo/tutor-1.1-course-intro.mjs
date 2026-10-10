/**
 * 教学视频 1.1 课程简介 场景模块（分镜表 S4~S8 录屏镜）。
 * 驱动：node scripts/tutor/record.mjs 1.1
 * 造数前置：node scripts/tutor/prep.mjs（工作台七维度需非空）
 */
import { sleep } from "../../scripts/tutor/record-core.mjs";

/** 展开导航分组（性能/UI 等默认折叠，S11 e2e 同口径）。 */
async function expandGroup(page, label) {
  const grp = page.locator(".nav-grp", { hasText: label }).first();
  if (await grp.count()) {
    const collapsed = await page.locator(`div.nav-grp-collapsed`, { hasText: label }).count();
    if (collapsed) {
      await page.getByText(label, { exact: true }).first().click();
      await sleep(400);
    }
  }
}

async function hoverItem(page, testid) {
  const el = page.getByTestId(testid).first();
  if (await el.count()) await el.hover({ timeout: 6000 });
  await sleep(900);
}

export const scenes = [
  {
    seg: "S4",
    run: async (page, h) => {
      await h.goto("/");
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(1200);
      // 七维度卡片逐个点亮：全景 → 逐卡 spotlight（卡片以标题文本定位）
      await h.narrate("S4");
      for (const t of ["用例", "计划", "执行", "报告"]) {
        const card = page.locator("a,div", { hasText: new RegExp(`^.*${t}.*$`) }).first();
        if (await card.count()) await h.spotlight(`text=${t}`, 1200).catch(() => {});
      }
      await h.zoom("main", 1.12, 700);
      await sleep(600);
    },
  },
  {
    seg: "S5",
    run: async (page, h) => {
      await h.goto("/");
      await sleep(800);
      await h.zoom('aside,nav,[class*="sidebar"]', 1.35, 700);
      await h.narrate("S5");
      for (const id of ["nav-reviews", "nav-plans", "nav-bugs"]) {
        await hoverItem(page, id);
      }
      await h.reset();
      await sleep(300);
    },
  },
  {
    seg: "S6",
    run: async (page, h) => {
      await h.goto("/");
      await sleep(800);
      await h.zoom('aside,nav,[class*="sidebar"]', 1.35, 700);
      await h.narrate("S6");
      for (const id of ["nav-apis", "nav-scenarios", "nav-reports", "nav-tasks"]) {
        await hoverItem(page, id);
      }
      await h.reset();
      await sleep(300);
    },
  },
  {
    seg: "S7",
    run: async (page, h) => {
      await h.goto("/");
      await sleep(800);
      await expandGroup(page, "性能测试");
      await expandGroup(page, "UI 测试");
      await h.zoom('aside,nav,[class*="sidebar"]', 1.3, 700);
      await h.narrate("S7");
      await hoverItem(page, "nav-load");
      await hoverItem(page, "nav-uit");
      // 项目设置分组展开 + 代码仓库/Agent 入口
      await expandGroup(page, "项目设置");
      await hoverItem(page, "nav-settings-code-repos");
      await hoverItem(page, "nav-settings-agents");
      await h.reset();
      await sleep(300);
    },
  },
  {
    seg: "S8",
    run: async (page, h) => {
      await h.goto("/");
      await sleep(800);
      await h.narrate("S8");
      await h.spotlight('[data-testid="topbar-ai-assistant"]', 1500);
      await page.getByTestId("header-bell").click();
      await sleep(1400);
      await h.spotlight('[data-testid="bell-dropdown"]', 1200).catch(() => {});
      await page.keyboard.press("Escape");
      await sleep(400);
    },
  },
];
