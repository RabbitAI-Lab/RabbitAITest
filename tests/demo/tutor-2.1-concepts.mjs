/**
 * 教学视频 2.1 测试管理·基本概念 场景模块（分镜表 S3~S6 录屏镜；S1/S2/S7/S8 由 compose 管）。
 * 驱动：node scripts/tutor/record.mjs 2.1
 * 造数前置：node scripts/tutor/prep.mjs（演示模块树 ×4 / 演示用例 ×10 / 演示公共脚本 ×1）
 * 概念导览集：全程只读浏览，不创建/不编辑任何数据。
 */
import { sleep } from "../../scripts/tutor/record-core.mjs";

/** 演示模块树根节点（prep.mjs MODULE_DEFS：登录/购物车/优惠券/订单，均为根节点） */
const DEMO_MODULES = ["演示-登录模块", "演示-购物车模块", "演示-优惠券模块", "演示-订单模块"];

/**
 * 每镜节拍（record-core 约定的场景级包装）：
 * 开头起拍 h.narrate(seg)（与动作并行，配音等待期内画面持续有运镜），
 * 收尾 await 起拍 promise 并按「分镜表时长 vs 配音时长」的较大值补足下限。
 */
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
    seg: "S3",
    run: async (page, h) => {
      const t0 = Date.now();
      const narrateP = startNarrate(h, "S3");
      // 全景 → 左侧模块树特写；右侧列表随树节点切换过滤（分镜：先全景，后 spotlight 树节点点击）
      await h.goto("/cases");
      await page
        .getByTestId("module-panel-case")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await page
        .getByTestId("case-table")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await sleep(1200);
      await h.zoom('[data-testid="module-panel-case"]', 1.22, 700);
      // 演示模块逐个点击：树与列表联动是本镜核心（录制要点：切换后等列表刷新完成再继续）
      const FIRST_CASE_OF = {
        "演示-登录模块": "演示-登录成功校验",
        "演示-购物车模块": "演示-添加商品到购物车",
        "演示-优惠券模块": "演示-领取优惠券",
      };
      for (const mod of DEMO_MODULES.slice(0, 3)) {
        const node = page.getByTestId(`module-node-${mod}`);
        if (await node.count()) {
          await node.click({ timeout: 8000 }).catch(() => {});
          // 等该模块首条用例出现（列表联动断言；超时则继续，不阻塞运镜）
          await page
            .getByText(FIRST_CASE_OF[mod])
            .first()
            .waitFor({ timeout: 10000 })
            .catch(() => {});
          await sleep(600);
          await h.spotlight(`[data-testid="module-node-${mod}"]`, 1300).catch(() => {});
          await sleep(900);
        }
      }
      // 回到第一个模块收尾（列表恢复登录模块口径），再回全景
      const firstNode = page.getByTestId(`module-node-${DEMO_MODULES[0]}`);
      if (await firstNode.count()) {
        await firstNode.click({ timeout: 8000 }).catch(() => {});
        await sleep(1000);
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
      // 从列表点编号链接进查看态详情（CASE-003：名称链接是编辑态，编号链接是查看态）
      await h.goto("/cases");
      await page
        .getByTestId("case-table")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      const row = page.getByRole("row", { name: /演示-添加商品到购物车/ });
      await row.waitFor({ timeout: 12000 }).catch(() => {});
      // 目标行未加载时兜底：任意行的编号链接
      const numLink = (await row.count())
        ? row.getByRole("link", { name: /^C-\d{4,}$/ })
        : page.getByRole("link", { name: /^C-\d{4,}$/ }).first();
      if (await numLink.count()) {
        await numLink.click({ timeout: 8000 }).catch(() => {});
        await page.waitForURL(/\/cases\/[\w-]+$/, { timeout: 12000 }).catch(() => {});
      }
      await page
        .getByTestId("case-title")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await sleep(1000);
      // 缩放至详情字段区：标题 + 步骤表（标准字段）
      await h.zoom("main", 1.18, 700);
      await h.spotlight('[data-testid="case-title"]', 1400).catch(() => {});
      const steps = page.getByTestId("case-steps-view");
      if (await steps.count()) {
        await h.panTo('[data-testid="case-steps-view"]');
        await h.spotlight('[data-testid="case-steps-view"]', 1600).catch(() => {});
      }
      // 自定义字段区域：模板绑定字段时才有（演示模板未绑定 → spotlight 面包屑标题区兜底）
      const dyn = page.getByTestId("case-dynamic-fields");
      if (await dyn.count()) {
        await h.spotlight('[data-testid="case-dynamic-fields"]', 1500).catch(() => {});
      } else {
        await h.spotlight('[data-testid="case-breadcrumb"]', 1200).catch(() => {});
      }
      await h.reset();
      await sleep(400);
      await settle(narrateP, 25, t0);
    },
  },
  {
    seg: "S5",
    run: async (page, h) => {
      const t0 = Date.now();
      const narrateP = startNarrate(h, "S5");
      // 模板管理：字段 Tab（自定义字段配置一览）→ 模板 Tab（模板列表），缓慢滚动
      await h.goto("/settings/templates");
      await page
        .getByTestId("tab-fields")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await sleep(1000);
      await h.spotlight('[data-testid="tab-fields"]', 1300).catch(() => {});
      if (await page.getByTestId("btn-new-field").count()) {
        await h.spotlight('[data-testid="btn-new-field"]', 1200).catch(() => {});
      }
      // 切到模板 Tab：系统默认模板行缓慢滚到视野中央（概念：模板决定字段组合）
      const tplTab = page.getByTestId("tab-templates");
      if (await tplTab.count()) {
        await tplTab.click({ timeout: 8000 }).catch(() => {});
        await sleep(1200);
        await page
          .getByText("功能用例默认模板", { exact: true })
          .waitFor({ timeout: 10000 })
          .catch(() => {});
        await page
          .locator("tr", { hasText: "功能用例默认模板" })
          .first()
          .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }))
          .catch(() => {});
        await sleep(900);
        await h.spotlight("main", 1500).catch(() => {});
      }
      await h.reset();
      await sleep(300);
      await settle(narrateP, 25, t0);
    },
  },
  {
    seg: "S6",
    run: async (page, h) => {
      const t0 = Date.now();
      const narrateP = startNarrate(h, "S6");
      // 两个全局资源位各停约 8s：公共脚本 → 文件库
      await h.goto("/settings/public-scripts");
      await page
        .getByTestId("page-settings-public-scripts")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await sleep(1000);
      const demoScript = page.getByText("演示-生成测试账号");
      if (await demoScript.count()) {
        await demoScript
          .first()
          .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }))
          .catch(() => {});
        await sleep(600);
        await h.spotlight("main table", 1600).catch(() => {});
      }
      await sleep(2200); // 公共脚本页停留（分镜：两页各停 8s，配音并行）
      await h.goto("/files");
      await page
        .getByTestId("file-list-table")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await sleep(1000);
      await h.zoom('[data-testid="file-manager"]', 1.15, 700);
      await h.spotlight('[data-testid="file-upload"]', 1500).catch(() => {});
      await sleep(2000); // 文件库停留
      await h.reset();
      await sleep(300);
      await settle(narrateP, 20, t0);
    },
  },
];
