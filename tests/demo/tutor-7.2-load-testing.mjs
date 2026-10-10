/**
 * 教学视频 7.2 性能测试 场景模块（分镜表 S3~S7 五个录屏镜）。
 * 驱动：node scripts/tutor/record.mjs 7.2
 * 前置：mock 栈起（压测目标 /perf/echo :4000）+ 演示项目性能测试模块开关开（缺省开）。
 *
 * 演示数据约定：「演示-」前缀 + 存在即复用——计划「演示-登录接口基线」
 * （目标 TPS 模式 / 8s / TPS 5 / 阈值 50%·8000ms·5000ms——阈值放宽为判定语义演示，e2e 同法）。
 * 选择器事实源：tests/e2e/S11-load-uit.spec.ts（LOAD-003-T8 段）。
 */
import { sleep, WEB, MOCK } from "../../scripts/tutor/record-core.mjs";

const PLAN_NAME = "演示-登录接口基线";

/** 跨镜状态（监控/报告页 taskId；重录单镜时 S6 现查历史兜底）。 */
const S = { taskId: null };

// ───────────────────────── 小助手（与 s2-helpers.pickOption 同法） ─────────────────────────

async function pickOption(page, trigger, optionText) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await trigger.click({ timeout: 5000 });
      const dropdown = page
        .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
        .filter({ visible: true })
        .last();
      await dropdown.waitFor({ state: "visible", timeout: 2500 });
      const opt = dropdown
        .getByText(optionText, typeof optionText === "string" ? { exact: true } : undefined)
        .first();
      await opt.click({ timeout: 3000 });
      return true;
    } catch (e) {
      lastErr = e;
    }
  }
  console.warn(`[tutor-7.2] pickOption 未选中「${String(optionText)}」：${lastErr?.message ?? ""}`);
  return false;
}

async function api(page, method, path, data) {
  try {
    const res =
      method === "GET"
        ? await page.request.get(`${WEB}${path}`)
        : await page.request.post(`${WEB}${path}`, { data });
    const body = await res.json().catch(() => null);
    return body?.code === 0 ? body.data : null;
  } catch {
    return null;
  }
}

let _pid = null;
async function pid(page) {
  if (_pid) return _pid;
  const data = await api(page, "GET", "/api/v1/personal/projects");
  const arr = Array.isArray(data) ? data : (data?.items ?? []);
  _pid = (arr.find((x) => x.name === "管理项目") ?? arr[0])?.id ?? null;
  return _pid;
}

async function findPlan(page) {
  const id = await pid(page);
  if (!id) return null;
  const data = await api(page, "GET", `/api/v1/projects/${id}/load-tests?pageSize=100`);
  return (data?.items ?? data?.list ?? []).find((t) => t.name === PLAN_NAME) ?? null;
}

async function padTo(t0, targetMs) {
  const remain = targetMs - (Date.now() - t0);
  if (remain > 300) await sleep(remain);
}

export const scenes = [
  // ── S3（25s）计划列表：新建按钮 + 历史入口扫过（轻量内核定位口播） ──
  {
    seg: "S3",
    run: async (page, h) => {
      const t0 = Date.now();
      try {
        await h.goto("/");
        await sleep(600);
        await h.expandGroup("性能测试");
        await page
          .getByTestId("nav-load")
          .first()
          .click()
          .catch(async () => {
            await h.goto("/load");
          });
        await page
          .getByTestId("load-page")
          .waitFor({ state: "visible", timeout: 60000 })
          .catch(() => {});
        await sleep(800);
        await h.narrate("S3");
        await h.spotlight('[data-testid="load-tests-table"]', 1500).catch(() => {});
        await h.spotlight('[data-testid="load-create-btn"]', 1500);
        // 历史入口扫过
        await page
          .getByText(/历史/)
          .first()
          .hover()
          .catch(() => {});
        await sleep(600);
        await h.reset();
      } catch (e) {
        console.warn(`[tutor-7.2] S3: ${e.message}`);
      }
      await padTo(t0, 25_000);
    },
  },

  // ── S4（45s）新建计划：名称/URL/目标 TPS 模式/时长 8s/TPS 5/阈值三项 → 保存 ──
  {
    seg: "S4",
    run: async (page, h) => {
      const t0 = Date.now();
      try {
        await h.goto("/load");
        await page
          .getByTestId("load-page")
          .waitFor({ state: "visible", timeout: 60000 })
          .catch(() => {});
        await sleep(600);
        await h.narrate("S4");
        const existed = await findPlan(page);
        if (existed?.id) {
          // 存在即复用：列表行 + 历史入口扫过
          await page
            .locator("tr", { hasText: PLAN_NAME })
            .first()
            .hover()
            .catch(() => {});
          await sleep(400);
          await h.spotlight('[data-testid="load-tests-table"]', 1600).catch(() => {});
          await h.reset();
          return;
        }
        await page.getByTestId("load-create-btn").click();
        await page
          .getByTestId("load-plan-form")
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => {});
        await sleep(500);
        // 目标请求：名称 + mock /perf/echo
        await h.spotlight('[data-testid="load-target-form"]', 1000);
        await page.getByPlaceholder("计划名称").fill(PLAN_NAME);
        await page.getByPlaceholder("http(s) 绝对 URL（压测目标）").fill(`${MOCK}/perf/echo`);
        // 压力模型：目标 TPS 模式 + 时长 8s + TPS 5
        await h.spotlight('[data-testid="load-pressure-form"]', 1000);
        await pickOption(
          page,
          page.locator('[data-testid="load-pressure-form"] .ant-select').first(),
          "目标 TPS（每秒发压配额）",
        );
        await page.getByRole("spinbutton", { name: /持续时长/ }).fill("8");
        await sleep(300);
        await page.getByRole("spinbutton", { name: /目标 TPS（1-1000）/ }).fill("5");
        // 阈值三项（演示环境放宽——e2e 同法）
        await h.spotlight('[data-testid="load-threshold-form"]', 1200);
        await page.getByRole("spinbutton", { name: /成功率 ≥/ }).fill("50");
        await sleep(250);
        await page.getByRole("spinbutton", { name: /P95 ≤/ }).fill("8000");
        await sleep(250);
        await page.getByRole("spinbutton", { name: /平均 RT ≤/ }).fill("5000");
        await sleep(400);
        await h.spotlight('[data-testid="load-save-btn"]', 1000);
        await page.getByTestId("load-save-btn").click();
        // 创建完成信号=跳回列表 + 表格含新计划
        await page.waitForURL(/\/load$/, { timeout: 10000 }).catch(() => {});
        await page
          .getByText(PLAN_NAME)
          .first()
          .waitFor({ state: "visible", timeout: 10000 })
          .catch(() => {});
        await sleep(600);
        await h.reset();
      } catch (e) {
        console.warn(`[tutor-7.2] S4: ${e.message}`);
      }
      await padTo(t0, 45_000);
    },
  },

  // ── S5（40s）执行 → 监控页：TPS 曲线实时推进 + 当前读数跳动 → 8s 跑完自动跳报告 ──
  {
    seg: "S5",
    run: async (page, h) => {
      const t0 = Date.now();
      try {
        await h.goto("/load");
        await page
          .getByTestId("load-page")
          .waitFor({ state: "visible", timeout: 60000 })
          .catch(() => {});
        await sleep(600);
        await h.narrate("S5");
        const row = page.locator("tr", { hasText: PLAN_NAME }).first();
        await row.getByTestId(/^load-run-/).click();
        await page.waitForURL(/\/load\/tasks\//, { timeout: 15000 }).catch(() => {});
        S.taskId =
          page
            .url()
            .split("/tasks/")[1]
            ?.split(/[^0-9a-f-]/)[0] ?? null;
        await page
          .getByTestId("load-monitor-page")
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => {});
        await page
          .getByTestId("load-monitor-chart")
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => {});
        // 状态卡 + 读数 spotlight（起压首帧 ≤15s——引擎口径）
        await h.spotlight('[data-testid="load-monitor-status"]', 1200);
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          const txt = (
            await page
              .getByTestId("load-tps-now")
              .innerText()
              .catch(() => "0")
          ).trim();
          if (txt && txt !== "0") break;
          await sleep(800);
        }
        await h.spotlight('[data-testid="load-tps-now"]', 1200);
        await h.zoom('[data-testid="load-monitor-chart"]', 1.15, 800).catch(() => {}); // 曲线区跟随
        // 8s 小计划自然跑完 → 终态自动跳报告（1.5s 跳 + 引擎收尾）
        await page.waitForURL(/\/load\/reports\//, { timeout: 30_000 }).catch(() => {});
        await sleep(800);
        await h.reset();
      } catch (e) {
        console.warn(`[tutor-7.2] S5: ${e.message}`);
      }
      await padTo(t0, 40_000);
    },
  },

  // ── S6（30s）报告页：汇总指标卡 + 完整曲线 + 结论判定 Tag（阈值给出通过/未通过） ──
  {
    seg: "S6",
    run: async (page, h) => {
      const t0 = Date.now();
      try {
        // 重录单镜兜底：无 taskId 时从执行历史取最近一条报告
        if (!S.taskId) {
          await h.goto("/load/history");
          await page
            .getByTestId("load-history-page")
            .waitFor({ state: "visible", timeout: 20000 })
            .catch(() => {});
          const first = page
            .locator('[data-testid^="load-report-link-"], .ant-table-tbody a')
            .first();
          await first.click().catch(() => {});
          await sleep(800);
        } else {
          await h.goto(`/load/reports/${S.taskId}`);
        }
        await page
          .getByTestId("load-report-page")
          .waitFor({ state: "visible", timeout: 30000 })
          .catch(() => {});
        await sleep(800);
        await h.narrate("S6");
        await h.spotlight('[data-testid="load-report-summary"]', 1600);
        await page
          .getByTestId("load-report-chart")
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => {});
        await h.zoom('[data-testid="load-report-chart"]', 1.12, 800).catch(() => {});
        await sleep(600);
        await h.reset();
        // 结论 Tag spotlight（按预设阈值判定）
        await page
          .getByTestId("load-report-verdict")
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => {});
        await h.spotlight('[data-testid="load-report-verdict"]', 1600);
        await h.reset();
      } catch (e) {
        console.warn(`[tutor-7.2] S6: ${e.message}`);
      }
      await padTo(t0, 30_000);
    },
  },

  // ── S7（15s）执行历史：任务列表回看（每次施压参数与结果留档） ──
  {
    seg: "S7",
    run: async (page, h) => {
      const t0 = Date.now();
      try {
        await h.goto("/load/history");
        await page
          .getByTestId("load-history-page")
          .waitFor({ state: "visible", timeout: 20000 })
          .catch(() => {});
        await sleep(600);
        await h.narrate("S7");
        await page
          .getByTestId("load-tasks-table")
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => {});
        await h.zoom(".ant-table-container", 1.1, 800).catch(() => {}); // 列表缓滚
        await sleep(600);
        await h.reset();
      } catch (e) {
        console.warn(`[tutor-7.2] S7: ${e.message}`);
      }
      await padTo(t0, 15_000);
    },
  },
];
