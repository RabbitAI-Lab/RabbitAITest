/**
 * 教学视频 3.1 接口测试·基本概念 场景模块（分镜表 S4~S6 录屏镜；S1/S2/S3/S7/S8 由 compose 管）。
 * 驱动：node scripts/tutor/record.mjs 3.1
 * 造数前置：node scripts/tutor/prep.mjs（演示接口定义 ×4：演示-用户登录/商品列表/创建订单/领取优惠券；演示环境 ×1）
 * 概念导览集：只读浏览，不发起调试请求（3.2 详讲调试）。
 */
import { sleep } from "../../scripts/tutor/record-core.mjs";

function startNarrate(h, seg) {
  return h.narrate(seg);
}

async function settle(narrateP, sec, t0) {
  const d = await narrateP;
  const elapsed = (Date.now() - t0) / 1000;
  const need = Math.max(sec, d) - elapsed;
  if (need > 0) await sleep(need * 1000);
}

export const scenes = [
  {
    seg: "S4",
    run: async (page, h) => {
      const t0 = Date.now();
      const narrateP = startNarrate(h, "S4");
      // /apis 列表全景：按模块分组的接口、方法标签、状态；关键字收敛到演示接口后缓慢滚动
      await h.goto("/apis");
      await page
        .getByTestId("api-list-table")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await sleep(1100);
      await h.zoom('main [data-testid="api-list-table"], main table', 1.12, 700);
      // 关键字「演示-」收敛到 4 条演示接口（GET/POST 方法标签、调试中/已发布状态一览）
      const kw = page.getByTestId("input-keyword");
      if (await kw.count()) {
        await kw.click({ timeout: 8000 }).catch(() => {});
        await page.keyboard.type("演示-", { delay: 40 });
        await page.keyboard.press("Enter");
        await sleep(2000);
      }
      // 缓慢滚动列表（分镜：缓慢滚动列表）
      await page.mouse.move(960, 540);
      await page.mouse.wheel(0, 320).catch(() => {});
      await sleep(900);
      await page.mouse.wheel(0, -320).catch(() => {});
      await sleep(700);
      // 方法标签与状态筛选位（概念：方法/状态一目了然）
      await h.spotlight('main [data-testid="api-list-table"]', 1600).catch(() => {});
      await h.spotlight('[data-testid="select-method"]', 1100).catch(() => {});
      await h.spotlight('[data-testid="select-status"]', 1100).catch(() => {});
      await h.reset();
      await settle(narrateP, 30, t0);
    },
  },
  {
    seg: "S5",
    run: async (page, h) => {
      const t0 = Date.now();
      const narrateP = startNarrate(h, "S5");
      // 环境管理：列表 → 演示环境 → 变量表（BaseUrl/变量：host=mock）；只读查看，不保存
      await h.goto("/settings/environments");
      await page
        .getByTestId("env-list-table")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await sleep(900);
      await h.spotlight('main [data-testid="env-list-table"]', 1300).catch(() => {});
      const envRow = page.getByTestId("env-list-table").getByText("演示环境");
      if (await envRow.count()) {
        await envRow
          .first()
          .click({ timeout: 8000 })
          .catch(() => {});
        await page
          .getByTestId("input-env-name")
          .waitFor({ timeout: 12000 })
          .catch(() => {});
        await sleep(900);
        // 变量区（表格区 spotlight）：变量贯穿执行全程
        const varsTab = page.getByTestId("env-tab-vars");
        if (await varsTab.count()) {
          await h.spotlight('[data-testid="env-tab-vars"]', 1200).catch(() => {});
        }
        const varRow = page.getByTestId("env-vars-row");
        if (await varRow.count()) {
          await h.panTo('[data-testid="env-vars-row"]');
          await h.spotlight('[data-testid="env-vars-row"]', 1700).catch(() => {});
        }
        await sleep(600);
        // 返回列表（不保存任何修改）
        const back = page.getByRole("button", { name: /返\s*回列表/ });
        if (await back.count()) await back.click({ timeout: 8000 }).catch(() => {});
        await sleep(700);
      }
      await h.reset();
      await settle(narrateP, 25, t0);
    },
  },
  {
    seg: "S6",
    run: async (page, h) => {
      const t0 = Date.now();
      const narrateP = startNarrate(h, "S6");
      // /debug 一瞥：全景 2s → 环境下拉展开（不深入，3.2 详讲）
      await h.goto("/debug");
      await page
        .getByTestId("debug-editor")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await sleep(2000); // 全景 2s（分镜口径）
      await h.zoom('[data-testid="debug-editor"]', 1.15, 700);
      await h.spotlight('[data-testid="debug-url"]', 1300).catch(() => {});
      await h.spotlight('[data-testid="btn-execute"]', 1100).catch(() => {});
      // 环境选择下拉：选中环境即可发起单次请求（概念展示，不点击执行）
      const envSel = page.getByTestId("env-select");
      if (await envSel.count()) {
        await h.spotlight('[data-testid="env-select"]', 1200).catch(() => {});
        await envSel.click({ timeout: 8000 }).catch(() => {});
        await sleep(900);
        const demoEnv = page
          .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
          .getByText("演示环境", { exact: true })
          .first();
        if (await demoEnv.count()) {
          await h
            .spotlight(".ant-select-dropdown:not(.ant-select-dropdown-hidden)", 1400)
            .catch(() => {});
        }
        await page.keyboard.press("Escape").catch(() => {});
        await sleep(400);
      }
      await h.reset();
      await settle(narrateP, 20, t0);
    },
  },
];
