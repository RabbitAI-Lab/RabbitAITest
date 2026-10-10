/**
 * 教学视频 3.6 测试报告 场景模块（分镜表 S3~S6 录屏镜）。
 * 驱动：node scripts/tutor/record.mjs 3.6
 * 造数前置：node scripts/tutor/prep.mjs（演示-下单主链路 两次执行：一次 SUCCESS、一次含失败项
 *   「领取优惠券（断言失败演示）」的 FAILED 报告——S3/S4 的下钻素材）
 *
 * 幂等口径：S6 分享链接已存在则复用（share-link-url 回读），不重复建 token；其余镜全部只读浏览。
 * 选择器来源：tests/e2e/RPT-002/003/004、API-006（场景报告视图 ScenarioReportPanels.tsx）。
 * 勘误（分镜表 vs 实际 UI，2026-10-10）：
 * - 任务报告页无「耗时分布」卡（summary 卡为 通过/失败[/误报] 计数 + 状态/耗时以报告头部与
 *   items 行呈现）——S3 以概览卡 + 明细滚动呈现。
 * - 任务报告页无「导出/下载报告」按钮（导出在计划报告 CSV：plans/{id}/report/export）；
 *   S6 按实际能力演示「分享链接免登查看」，导出口径见分镜勘误。
 */
import { sleep, WEB } from "../../scripts/tutor/record-core.mjs";

async function tap(page, sel, { timeout = 6000 } = {}) {
  try {
    const el = page.getByTestId(sel).first();
    if (!(await el.count())) return false;
    await el.click({ timeout });
    return true;
  } catch {
    return false;
  }
}

async function has(page, sel) {
  return (await page.getByTestId(sel).count()) > 0;
}

async function apiGet(page, pathname) {
  try {
    const res = await page.request.get(`${WEB}${pathname}`);
    if (!res.ok()) return null;
    const json = await res.json();
    return json?.code === 0 ? json.data : null;
  } catch {
    return null;
  }
}

async function projId(page) {
  const data = await apiGet(page, "/api/v1/personal/projects");
  const project = (data ?? []).find((p) => p.name === "管理项目") ?? (data ?? [])[0];
  return project?.id ?? null;
}

/** 定位演示失败报告（S3/S4 素材）：报告列表 API 优先，失败回退到列表页 DOM。 */
async function findFailedReport(page) {
  const pid = await projId(page);
  if (pid) {
    for (const reportType of ["scenario", "api_case"]) {
      const list = await apiGet(
        page,
        `/api/v1/projects/${pid}/reports?page=1&pageSize=20&reportType=${reportType}`,
      );
      const hit = (list?.items ?? []).find((i) => i.status === "FAILED");
      if (hit) return { taskId: hit.taskId, via: "api" };
    }
  }
  return null;
}

async function fillDur(t0, seconds) {
  const remain = seconds * 1000 - (Date.now() - t0);
  if (remain > 0) await sleep(remain);
}

export const scenes = [
  {
    seg: "S3",
    run: async (page, h) => {
      const t0 = Date.now();
      // 报告列表 → 失败任务报告详情：概览卡 + 明细滚动（全景 1s → 概览卡 spotlight → 明细 panTo）
      await h.goto("/reports");
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(1200);
      await h.narrate("S3");
      const hit = await findFailedReport(page);
      let opened = false;
      if (hit) {
        await h.goto(`/reports/${hit.taskId}`);
        await page
          .getByTestId("report-status")
          .first()
          .waitFor({ timeout: 15000 })
          .catch(() => {});
        opened = true;
      } else {
        // 兜底：列表行内首个「失败」报告链接（DOM 定位，API 不可用时仍可录）
        const failRow = page
          .getByTestId("report-list-table")
          .getByRole("row", { name: /失败/ })
          .first();
        if (await failRow.count()) {
          const link = failRow.getByTestId("report-name-link");
          if (await link.count()) {
            await link.click();
            await page.waitForURL(/\/reports\/[a-z0-9-]+/i, { timeout: 12000 }).catch(() => {});
            opened = true;
          }
        }
      }
      await sleep(1000);
      // 概览卡（scenario=五卡 / api_case=三卡，都先 spotlight 再滚动明细）
      await h
        .spotlight(
          '[data-testid="scenario-summary-cards"], [data-testid="report-summary-cards"]',
          1600,
        )
        .catch(() => {});
      const items = page
        .getByTestId("scenario-items-table")
        .or(page.getByTestId("report-items-table"))
        .first();
      if (await items.count()) {
        await h.panTo('[data-testid^="scenario-items-table"], [data-testid^="report-items-table"]');
        await sleep(600);
      }
      void opened;
      await h.reset();
      await fillDur(t0, 40);
    },
  },
  {
    seg: "S4",
    run: async (page, h) => {
      const t0 = Date.now();
      // 失败下钻：场景报告 → 步骤树失败节点 → 步骤钻取（请求/响应快照 + 断言失败原因红行）
      const hit = await findFailedReport(page);
      if (!hit) {
        await fillDur(t0, 35);
        return;
      }
      await h.goto(`/reports/${hit.taskId}`);
      await page
        .getByTestId("report-status")
        .first()
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await sleep(800);
      await h.narrate("S4");
      // ① 场景视图：items 行 → 步骤树 → 失败节点 → step-drill-panel
      const scenTree = page.getByTestId("scenario-tree-card");
      if (await scenTree.count()) {
        await h.spotlight('[data-testid="scenario-items-table"]', 1200).catch(() => {});
        const failNode = page
          .locator('[data-testid^="tree-node-"]')
          .filter({ hasText: /领取优惠券|失败|FAIL/ })
          .first();
        if (await failNode.count()) {
          await h.zoom('[data-testid="scenario-tree-card"]', 1.15, 600);
          await failNode.click();
          await page
            .waitForSelector('[data-testid="step-drill-panel"]', { timeout: 10000 })
            .catch(() => {});
          await sleep(700);
          // 展开动画完整保留；断言失败原因行保持高亮 2s
          await h.spotlight('[data-testid="step-drill-panel"]', 2000).catch(() => {});
        }
      } else {
        // ② api_case 视图：items 失败行 → item-drilldown（请求/响应快照/断言表/提取/日志）
        const failRow = page
          .getByTestId("report-items-table")
          .getByRole("row", { name: /FAILED/ })
          .first();
        if (await failRow.count()) {
          await failRow.click();
          await page
            .waitForSelector('[data-testid="item-drilldown"]', { timeout: 10000 })
            .catch(() => {});
          await sleep(700);
          await h.spotlight('[data-testid="drill-request"]', 1500).catch(() => {});
          await h.spotlight('[data-testid="drill-response"]', 1200).catch(() => {});
          await h.spotlight('[data-testid="asserts-table"] tr.bg-red-50', 2000).catch(() => {});
          await h.panTo('[data-testid="drill-logs"]');
        }
      }
      await h.reset();
      await fillDur(t0, 35);
    },
  },
  {
    seg: "S5",
    run: async (page, h) => {
      const t0 = Date.now();
      // 统计大盘：趋势图（缓推）→ 窗口切换 7 天 → 分布/失败 TOP
      await h.goto("/reports/stats");
      await page.waitForSelector('[data-testid="stats-trend"]', { timeout: 15000 }).catch(() => {});
      await sleep(1200);
      await h.narrate("S5");
      await h.zoom('[data-testid="stats-trend"]', 1.12, 700);
      await h.spotlight('[data-testid="stats-trend-summary"]', 1400).catch(() => {});
      // 窗口切换（7 天）——接口带 days=7 刷新
      const d7 = page.getByTestId("stats-range").getByText("7 天").first();
      if (await d7.count()) {
        await d7.click();
        await sleep(1500);
        await h.spotlight('[data-testid="stats-trend"]', 1200).catch(() => {});
      }
      await h.panTo('[data-testid="stats-bytype"]');
      await h.spotlight('[data-testid="stats-topfailed"]', 1400).catch(() => {});
      await h.reset();
      await fillDur(t0, 25);
    },
  },
  {
    seg: "S6",
    run: async (page, h) => {
      const t0 = Date.now();
      // 分享：报告详情 → 分享弹窗（已存在链接则复用）→ 复制链接 → 免登分享页
      const hit = await findFailedReport(page);
      if (!hit) {
        await fillDur(t0, 30);
        return;
      }
      await h.goto(`/reports/${hit.taskId}`);
      await page
        .getByTestId("report-status")
        .first()
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await sleep(600);
      await h.narrate("S6");
      if (await tap(page, "btn-share-report")) {
        await page
          .waitForSelector('[data-testid="share-report-modal"]', { timeout: 10000 })
          .catch(() => {});
        await sleep(700);
        let token = null;
        const urlInput = page.getByTestId("share-link-url").first();
        if ((await urlInput.count()) && (await urlInput.inputValue()).includes("/share/report/")) {
          token = (await urlInput.inputValue()).split("/share/report/")[1]?.split(/[?#]/)[0];
        }
        if (!token && (await has(page, "btn-create-share"))) {
          const respP = page
            .waitForResponse((r) => /\/shares$/.test(r.url()) && r.request().method() === "POST")
            .catch(() => null);
          await h.spotlight('[data-testid="btn-create-share"]', 900).catch(() => {});
          await page.getByTestId("btn-create-share").click();
          const resp = await respP;
          if (resp) {
            try {
              token = (await resp.json())?.data?.token ?? null;
            } catch {
              token = null;
            }
          }
          await sleep(800);
        }
        // 复制 + 免登打开（share 页公开访问，share-banner 标注「只读分享」）
        if (token) {
          await h.goto(`/share/report/${token}`);
          await page
            .waitForSelector('[data-testid="share-report-view"]', { timeout: 15000 })
            .catch(() => {});
          await sleep(900);
          await h.spotlight('[data-testid="share-banner"]', 1500).catch(() => {});
          await h.spotlight('[data-testid="share-report-view"]', 1200).catch(() => {});
        }
      }
      await h.reset();
      await fillDur(t0, 30);
    },
  },
];
