/**
 * 教学视频 3.5 执行任务与资源池 场景模块（分镜表 S3~S7 录屏镜；S1/S2/S8/S9 由 compose 管）。
 * 驱动：node scripts/tutor/record.mjs 3.5
 * 造数前置：node scripts/tutor/prep.mjs（演示场景「演示-下单主链路」×2 次真实执行：SUCCESS + 含失败项；
 *   演示环境 ×1；系统默认资源池由 seed 预置，engine 心跳在线）
 * admin 为系统管理员：/system/* 可访问（EXEC-002 同口径）。
 *
 * 批次口径：S3 执行弹窗只演示「环境 + 资源池」两个下拉后取消（不提交，不新增任务）；
 * S4/S7 浏览 prep 产生的既有任务（进度列 + 报告 + 行内重跑按钮 spotlight，不真实重跑）。
 */
import { sleep } from "../../scripts/tutor/record-core.mjs";

const SCENARIO_NAME = "演示-下单主链路";

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
      // 场景列表 → 演示场景行内「执行」→ 弹窗内 环境 / 资源池 两个下拉各展开一次 → 取消
      await h.goto("/scenarios");
      await page
        .getByTestId("module-panel-scenario")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await page
        .getByText(SCENARIO_NAME)
        .first()
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await sleep(900);
      const row = page.locator("tr", { hasText: SCENARIO_NAME });
      const execBtn = (await row.count())
        ? row.locator('[data-testid^="btn-exec-scenario-"]').first()
        : page.locator('[data-testid^="btn-exec-scenario-"]').first();
      if (await execBtn.count()) {
        await h.spotlight("main table", 1200).catch(() => {});
        await execBtn.click({ timeout: 8000 }).catch(() => {});
        await sleep(1100);
        // 发起执行选两样东西：环境（EnvSelect）与 资源池
        const envSel = page.getByTestId("env-select");
        if (await envSel.count()) {
          await h.spotlight('[data-testid="env-select"]', 1200).catch(() => {});
          await envSel.click({ timeout: 8000 }).catch(() => {});
          await sleep(900);
          await h
            .spotlight(".ant-select-dropdown:not(.ant-select-dropdown-hidden)", 1300)
            .catch(() => {});
          const opt = page
            .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
            .getByText("演示环境", { exact: true })
            .first();
          if (await opt.count()) await opt.click({ timeout: 5000 }).catch(() => {});
          await sleep(700);
        }
        const poolSel = page.getByTestId("select-exec-pool");
        if (await poolSel.count()) {
          await h.spotlight('[data-testid="select-exec-pool"]', 1200).catch(() => {});
          await poolSel.click({ timeout: 8000 }).catch(() => {});
          await sleep(900);
          await h
            .spotlight(".ant-select-dropdown:not(.ant-select-dropdown-hidden)", 1300)
            .catch(() => {});
          await page.keyboard.press("Escape").catch(() => {});
          await sleep(500);
        }
        // 串行/并行模式（按资源池并发槽同时运行）
        await h.spotlight('[data-testid="radio-exec-mode"]', 1200).catch(() => {});
        await h.spotlight('[data-testid="switch-stop-on-fail"]', 1100).catch(() => {});
        // 不提交：取消关闭弹窗（批次只读口径）
        const cancel = page.getByRole("dialog").getByRole("button", { name: /取\s*消/ });
        if (await cancel.count()) await cancel.click({ timeout: 8000 }).catch(() => {});
        await sleep(600);
      }
      await h.reset();
      await settle(narrateP, 30, t0);
    },
  },
  {
    seg: "S4",
    run: async (page, h) => {
      const t0 = Date.now();
      const narrateP = startNarrate(h, "S4");
      // /tasks 任务列表：本项目 Tab、既有任务行（类型徽标/状态/进度列）、进入报告详情
      await h.goto("/tasks");
      await page
        .getByTestId("task-list-table")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await page
        .getByTestId("scope-tab-project")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await sleep(900);
      await h.spotlight('[data-testid="scope-tabs"]', 1300).catch(() => {});
      const firstRow = page
        .getByTestId("task-list-table")
        .locator("tbody tr:not(.ant-table-placeholder)")
        .first();
      const hasRows = await firstRow
        .waitFor({ timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      if (hasRows) {
        // 进度列特写（SSE 实时刷新的呈现位；终态任务展示 2/3 等进度值）
        await h.spotlight('[data-testid^="task-row-"]', 1500).catch(() => {});
        await sleep(600);
        // 查看报告 → 任务详情流（报告页即任务执行明细）
        const viewReport = page.getByTestId("btn-view-report-0");
        if (await viewReport.count()) {
          await viewReport.click({ timeout: 8000 }).catch(() => {});
          await page.waitForURL(/\/reports\//, { timeout: 15000 }).catch(() => {});
          const status = page.getByTestId("report-status");
          await status.waitFor({ timeout: 15000 }).catch(() => {});
          await sleep(800);
          await h.spotlight('[data-testid="report-status"]', 1400).catch(() => {});
          await h.spotlight("main", 1400).catch(() => {});
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
      // /system/pools 资源池管理（系统管理域，admin 可访问）：默认池卡片 + 节点表 + 并发槽配置（只展示不保存）
      await h.goto("/system/pools");
      const poolCard = page.locator('[data-testid^="pool-card-"]').first();
      const cardOk = await poolCard
        .waitFor({ timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      await sleep(800);
      if (cardOk) {
        const cardSel = await page
          .locator('[data-testid^="pool-card-"]')
          .first()
          .evaluate((el) => `[data-testid="${el.dataset.testid}"]`);
        await h.spotlight(cardSel, 1500).catch(() => {});
        // 节点表：engine 心跳在线 + 槽位（x÷N）
        const nodes = page.getByTestId("pool-nodes");
        if (await nodes.count()) {
          await h.panTo('[data-testid="pool-nodes"]');
          await h.spotlight('[data-testid="pool-nodes"]', 1800).catch(() => {});
        }
        // 并发槽数量配置：打开编辑弹窗 spotlight 后取消（不保存任何修改）
        const editBtnSel = await page
          .locator('[data-testid^="btn-edit-pool-"]')
          .first()
          .evaluate((el) => `[data-testid="${el.dataset.testid}"]`)
          .catch(() => null);
        if (editBtnSel) {
          await page
            .locator(editBtnSel)
            .click({ timeout: 8000 })
            .catch(() => {});
          await sleep(1000);
          await h.spotlight('[data-testid="input-pool-concurrency"]', 1600).catch(() => {});
          await sleep(500);
          const cancel = page.getByRole("dialog").getByRole("button", { name: /取\s*消/ });
          if (await cancel.count()) await cancel.click({ timeout: 8000 }).catch(() => {});
          else await page.keyboard.press("Escape").catch(() => {});
          await sleep(600);
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
      // /personal/local-runner 本地执行器：用途说明与连接配置（全景展示，不触发检测）
      await h.goto("/personal/local-runner");
      await page
        .getByTestId("page-personal-local-runner")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await sleep(1200);
      await h.zoom('[data-testid="page-personal-local-runner"]', 1.14, 700);
      await h.spotlight('[data-testid="local-runner-address"]', 1500).catch(() => {});
      await h.spotlight('[data-testid="local-runner-check"]', 1200).catch(() => {});
      await h.spotlight('[data-testid="local-runner-prefer"]', 1200).catch(() => {});
      await sleep(600);
      await h.reset();
      await settle(narrateP, 20, t0);
    },
  },
  {
    seg: "S7",
    run: async (page, h) => {
      const t0 = Date.now();
      const narrateP = startNarrate(h, "S7");
      // 失败项重跑（展示位）：FAILED 行的重跑按钮 spotlight + 打开该任务报告看未通过项（不真实重跑）
      await h.goto("/tasks");
      await page
        .getByTestId("task-list-table")
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      const rerunBtn = page.locator('[data-testid^="btn-rerun-"]').first();
      const hasRerun = await rerunBtn
        .waitFor({ timeout: 8000 })
        .then(() => true)
        .catch(() => false);
      if (hasRerun) {
        const rerunRow = page
          .locator("tr", { has: page.locator('[data-testid^="btn-rerun-"]') })
          .first();
        await rerunRow.scrollIntoViewIfNeeded().catch(() => {});
        await sleep(500);
        await h.spotlight('button[data-testid^="btn-rerun-"]', 1500).catch(() => {});
        // 该失败任务的报告：失败项一目了然（只补跑失败部分的入口说明）
        const viewReport = rerunRow.getByTestId(/btn-view-report-\d/);
        if (await viewReport.count()) {
          await viewReport
            .first()
            .click({ timeout: 8000 })
            .catch(() => {});
          await page.waitForURL(/\/reports\//, { timeout: 12000 }).catch(() => {});
          await page
            .getByTestId("report-status")
            .waitFor({ timeout: 10000 })
            .catch(() => {});
          await sleep(600);
          await h.spotlight('[data-testid="report-status"]', 1300).catch(() => {});
        }
      } else {
        // 无 FAILED 任务时退化为任务列表全景（prep 第 2 次场景执行含失败断言，正常应存在）
        await h.spotlight('[data-testid="task-list-table"]', 1500).catch(() => {});
      }
      await h.reset();
      await settle(narrateP, 15, t0);
    },
  },
];
