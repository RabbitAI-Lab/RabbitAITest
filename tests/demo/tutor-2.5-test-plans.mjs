/**
 * 教学视频 2.5 测试计划 场景模块（分镜表 S3~S7 录屏镜）。
 * 驱动：node scripts/tutor/record.mjs 2.5
 * 造数前置：node scripts/tutor/prep.mjs（演示-回归计划（已完成）/演示-冒烟计划（进行中）/
 *   演示-回归计划组 + 10 条演示用例 + 4 个演示接口定义 + 演示-下单主链路场景）
 *
 * 本集写操作幂等：新建计划「演示-新功能验证计划」先查重再建；关联/执行仅对未关联/未执行条目做；
 * 分享链接已存在则复用不重建。
 * 选择器来源：tests/e2e/PLAN-001/002/003/004/005（已核对源码 plans/page.tsx、plans/[id]/page.tsx、
 * components/plan/PointsPanel.tsx）。
 * 勘误（分镜表 vs 实际 UI，2026-10-10）：
 * - /plans/groups 列表页不存在（只有组报告页 /plans/groups/[groupId]）；分组的新建/移入都在 /plans
 *   列表页内（btn-new-plan-group / plan-move-group-{id} 弹窗「移入」，非拖拽）——S6 按实际 UI 走。
 * - 新建计划表单无「负责人」字段（名称/起止/标签/阈值在「更多设置」抽屉内补充）——S3 只演示名称+阈值。
 */
import { sleep, WEB } from "../../scripts/tutor/record-core.mjs";

const PLAN_NAME = "演示-新功能验证计划";
const LINK_CASE = "演示-添加商品到购物车";
const LINK_API_CASE = "演示-商品列表-服务状态校验";
const LINK_SCENARIO = "演示-下单主链路";
const GROUP_NAME = "演示-回归计划组";
const ARCHIVED_PLAN = "演示-回归计划（已完成）";
const SMOKE_PLAN = "演示-冒烟计划（进行中）";

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

async function findPlan(page, name) {
  const pid = await projId(page);
  if (!pid) return null;
  const list = await apiGet(page, `/api/v1/projects/${pid}/plans?pageSize=100`);
  return (list?.items ?? []).find((i) => i.name === name) ?? null;
}

async function fillDur(t0, seconds) {
  const remain = seconds * 1000 - (Date.now() - t0);
  if (remain > 0) await sleep(remain);
}

/** 从计划详情 API 拿用例/接口/场景引用（判定已关联与未执行行）。 */
async function planRefs(page, planId) {
  const pid = await projId(page);
  if (!pid) return null;
  return apiGet(page, `/api/v1/projects/${pid}/plans/${planId}`);
}

/** 计划是否已在任一分组内（/plan-groups 返回 groups[].members + ungrouped，/plans 列表无 groupId）。 */
async function planInAnyGroup(page, planId) {
  const pid = await projId(page);
  if (!pid) return false;
  const data = await apiGet(page, `/api/v1/projects/${pid}/plan-groups`);
  const members = (data?.groups ?? []).flatMap((g) => g.members ?? []);
  return members.some((m) => m.id === planId);
}

export const scenes = [
  {
    seg: "S3",
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/plans");
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(1200);
      await h.narrate("S3");
      const existed = await findPlan(page, PLAN_NAME);
      if (!existed && (await tap(page, "btn-new-plan"))) {
        await sleep(700);
        await h.zoom(".ant-modal", 1.15, 600);
        await h.type('[data-testid="input-plan-name"]', PLAN_NAME);
        await sleep(300);
        // 起止时间（antd RangePicker，弹层不稳定——spotlight 带过即可，不强选日期）
        await h.spotlight('[data-testid="input-plan-range"]', 1000).catch(() => {});
        await page
          .getByTestId("input-plan-range")
          .click()
          .catch(() => {});
        await sleep(900);
        await page.keyboard.press("Escape");
        await sleep(300);
        const th = page.getByTestId("input-threshold");
        if (await th.count()) await th.fill("80");
        await sleep(300);
        await h.spotlight('[data-testid="btn-submit-plan"]', 900);
        await page.getByTestId("btn-submit-plan").click();
        await sleep(1500);
      }
      // 进详情：列表行名称链接（用户路径内跳转）
      const link = page.getByRole("link", { name: PLAN_NAME }).first();
      if (await link.count()) {
        await link.click();
        await page
          .waitForSelector('[data-testid="plan-cases-tab"]', { timeout: 12000 })
          .catch(() => {});
        await sleep(800);
      }
      await h.reset();
      await fillDur(t0, 30);
    },
  },
  {
    seg: "S4",
    run: async (page, h) => {
      const t0 = Date.now();
      // 关联范围三类资产：功能用例（用例清单弹窗）/ 接口用例 + 场景（测试规划弹窗三页签）
      const plan = await findPlan(page, PLAN_NAME);
      const url = plan ? `/plans/${plan.id}` : "/plans";
      await h.goto(url);
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(1000);
      await h.narrate("S4");
      const refs = plan ? ((await planRefs(page, plan.id)) ?? null) : null;
      const linkedNames = new Set((refs?.cases ?? []).map((c) => c.name ?? c.refName ?? ""));

      // ① 功能用例：btn-link-cases → 检索勾选 → 确认
      if (await tap(page, "btn-link-cases")) {
        await sleep(600);
        await h.spotlight('[data-testid="link-cases-modal"]', 1200).catch(() => {});
        if (!linkedNames.has(LINK_CASE)) {
          await page.getByTestId("link-cases-keyword").fill(LINK_CASE);
          await sleep(800);
          const ck = page
            .getByTestId("link-cases-modal")
            .getByRole("row", { name: new RegExp(LINK_CASE) })
            .locator('input[type="checkbox"]')
            .first();
          if (await ck.count()) {
            await ck.check();
            await sleep(400);
          }
          await tap(page, "btn-confirm-link-cases");
          await page
            .getByTestId("plan-cases-tab")
            .getByText(/用例清单（\d/)
            .first()
            .waitFor({ timeout: 8000 })
            .catch(() => {});
        }
        await page.keyboard.press("Escape");
        await sleep(500);
      }

      // ②③ 接口用例 + 场景：测试规划 Tab → btn-link-to-point 三页签弹窗（PointsPanel）
      if (await tap(page, "plan-points-tab")) {
        await sleep(700);
        if (await tap(page, "btn-link-to-point")) {
          await sleep(600);
          const dlg = page.getByRole("dialog");
          // 接口用例页签：下拉选定义 → 候选列表点用例
          const apiTab = dlg.getByRole("tab", { name: "接口用例" });
          if (await apiTab.count()) {
            await apiTab.click();
            await sleep(500);
            if (!linkedNames.has(LINK_API_CASE)) {
              const combo = dlg.getByRole("combobox").first();
              if (await combo.count()) {
                await combo.click();
                await page.keyboard.press("ArrowDown");
                await page.keyboard.press("Enter");
                await sleep(700);
              }
              const cand = page.getByTestId("link-candidates").getByText(LINK_API_CASE).first();
              if (await cand.count()) {
                await cand.click();
                await sleep(300);
                await tap(page, "btn-confirm-link");
                await sleep(1500);
              }
            }
          }
          // 场景页签（同弹窗第三页签，各给一次入口特写）
          if (!linkedNames.has(LINK_SCENARIO)) {
            const scTab = page.getByRole("dialog").getByRole("tab", { name: "场景" });
            if (await scTab.count()) {
              await scTab.click();
              await sleep(500);
              const cand = page.getByTestId("link-candidates").getByText(LINK_SCENARIO).first();
              if (await cand.count()) {
                await cand.click();
                await sleep(300);
                await tap(page, "btn-confirm-link");
                await sleep(1500);
              }
            }
          }
          await page.keyboard.press("Escape").catch(() => {});
          await sleep(400);
        }
        await h.spotlight('[data-testid="plan-points-panel"]', 1200).catch(() => {});
      }
      // 用例清单分块展示（功能/接口·场景徽标）
      if (await tap(page, "plan-cases-tab")) await sleep(900);
      await h.spotlight('[data-testid="plan-cases-table"]', 1200).catch(() => {});
      await h.reset();
      await fillDur(t0, 45);
    },
  },
  {
    seg: "S5",
    run: async (page, h) => {
      const t0 = Date.now();
      // 执行视图：对未执行行逐步骤标记 PASS，顶部通过率环实时变化（核心画面）
      const plan = (await findPlan(page, SMOKE_PLAN)) ?? (await findPlan(page, PLAN_NAME));
      if (!plan) {
        await fillDur(t0, 45);
        return;
      }
      await h.goto(`/plans/${plan.id}`);
      await page
        .waitForSelector('[data-testid="plan-cases-tab"]', { timeout: 12000 })
        .catch(() => {});
      await sleep(800);
      await h.narrate("S5");
      await h.spotlight('[data-testid="plan-circle"]', 1200).catch(() => {});
      const refs = (await planRefs(page, plan.id)) ?? { cases: [] };
      const pending = (refs.cases ?? []).filter(
        (c) => c.refType === "functional_case" && (!c.status || c.status === "NOT_RUN"),
      );
      // 逐条标记（最多 3 条，让进度条肉眼可见跳动）
      for (const ref of pending.slice(0, 3)) {
        const btn = page.getByTestId(`btn-step-exec-${ref.id}`).first();
        if (!(await btn.count())) continue;
        await btn.click();
        await page
          .waitForSelector('[data-testid="step-exec-panel"]', { timeout: 8000 })
          .catch(() => {});
        await sleep(500);
        await h.spotlight('[data-testid="step-exec-panel"]', 800).catch(() => {});
        const pass1 = page.getByTestId("step-btn-PASS-1").first();
        if (await pass1.count()) {
          await pass1.click();
          await sleep(300);
        }
        const save = page.getByTestId(`btn-save-exec-${ref.id}`).first();
        if (await save.count()) {
          await save.click();
          await sleep(1500); // 等通过率环刷新
        }
        await h.spotlight('[data-testid="plan-circle"]', 900).catch(() => {});
      }
      if (!pending.length) {
        // 重录口径：全部已执行 → 特写通过率环 + 阈值徽标（进度条变化已无从演示，仅展示终态）
        await h.spotlight('[data-testid="plan-pass-rate-box"]', 1500).catch(() => {});
      }
      await h.reset();
      await fillDur(t0, 45);
    },
  },
  {
    seg: "S6",
    run: async (page, h) => {
      const t0 = Date.now();
      // 分组管理在 /plans 列表页内（无 /plans/groups 列表页，见文件头勘误）：
      // 已有演示分组则展示 + 展开；未入组计划走「移入分组」弹窗
      await h.goto("/plans");
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(1000);
      await h.narrate("S6");
      const groupRow = page.locator('[data-testid^="plan-group-row-"]').first();
      if (await groupRow.count()) {
        await h.spotlight('[data-testid^="plan-group-row-"]', 1300).catch(() => {});
        const expand = groupRow.getByRole("button", { name: /展开/ });
        if (await expand.count()) await expand.click().catch(() => {});
        await sleep(700);
      } else if (await tap(page, "btn-new-plan-group")) {
        // 兜底：无分组时新建演示分组
        await page.getByTestId("input-group-name").fill(GROUP_NAME);
        await page.keyboard.press("Enter");
        await sleep(1200);
      }
      // 把演示计划移入分组（幂等：已入任一组则跳过；按 plan-move-group-{id} 弹窗「移入」）
      const plan = await findPlan(page, PLAN_NAME);
      if (plan && !(await planInAnyGroup(page, plan.id))) {
        const mv = page.getByTestId(`plan-move-group-${plan.id}`).first();
        if (await mv.count()) {
          await mv.click();
          await sleep(600);
          const opt = page.getByRole("dialog").getByText(GROUP_NAME).first();
          if (await opt.count()) {
            await opt.click();
            await sleep(300);
            const ok = page
              .getByRole("dialog")
              .getByRole("button", { name: /移\s*入|移入/ })
              .first();
            if (await ok.count()) await ok.click();
            await sleep(1200);
          }
        }
      }
      await h.reset();
      await fillDur(t0, 20);
    },
  },
  {
    seg: "S7",
    run: async (page, h) => {
      const t0 = Date.now();
      // 报告 Tab（用已完成的回归计划——六卡 + 阈值横幅 + 一键总结）→ 分享链接 → 免登页
      const plan = (await findPlan(page, ARCHIVED_PLAN)) ?? (await findPlan(page, PLAN_NAME));
      if (!plan) {
        await fillDur(t0, 35);
        return;
      }
      await h.goto(`/plans/${plan.id}`);
      await page
        .waitForSelector('[data-testid="plan-cases-tab"]', { timeout: 12000 })
        .catch(() => {});
      await h.narrate("S7");
      if (await tap(page, "plan-report-tab")) {
        await page
          .waitForSelector('[data-testid="plan-report-v2"]', { timeout: 10000 })
          .catch(() => {});
        await sleep(800);
        await h.spotlight('[data-testid="report-threshold-banner"]', 1300).catch(() => {});
        // 一键总结（draft 为只读生成接口）
        if (await tap(page, "btn-report-draft")) {
          await sleep(1500);
          await page
            .getByRole("button", { name: /确\s*定/ })
            .first()
            .click()
            .catch(() => {});
          await sleep(800);
        }
        // 分享：已有链接复用，无则创建（POST /report/shares）
        if (await tap(page, "btn-report-share")) {
          await page
            .waitForSelector('[data-testid="btn-create-share"]', { timeout: 10000 })
            .catch(() => {});
          await sleep(700);
          let token = null;
          const urlInput = page.getByTestId("share-link-url").first();
          if ((await urlInput.count()) && (await urlInput.inputValue()).includes("/share/plan/")) {
            token = (await urlInput.inputValue()).split("/share/plan/")[1]?.split(/[?#]/)[0];
          }
          if (!token && (await has(page, "btn-create-share"))) {
            const respP = page
              .waitForResponse(
                (r) => /\/report\/shares$/.test(r.url()) && r.request().method() === "POST",
              )
              .catch(() => null);
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
          // 打开分享页（免登可见）
          if (token) {
            await h.goto(`/share/plan/${token}`);
            await page
              .waitForSelector('[data-testid="share-plan-page"]', { timeout: 15000 })
              .catch(() => {});
            await sleep(1000);
            await h.spotlight('[data-testid="share-plan-page"]', 1500).catch(() => {});
          }
        }
      }
      await h.reset();
      await fillDur(t0, 35);
    },
  },
];
