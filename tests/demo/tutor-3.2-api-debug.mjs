/**
 * 教学视频 3.2 接口调试 场景模块（分镜表 S3~S6 录屏镜）。
 * 驱动：node scripts/tutor/record.mjs 3.2
 * 造数前置：node scripts/tutor/prep.mjs（演示环境 host=http://127.0.0.1:4000；mock 栈在跑）
 *
 * 每次录制的「执行」会产生真实 api_debug 任务与报告（教学演示本身就是要执行，接受重录追加）；
 * 「保存为接口」幂等：接口名带「演示-」前缀且先查重再建。
 * 选择器来源：tests/e2e/API-001/004（已核对源码 debug/page.tsx、components/api/RequestEditor.tsx）。
 * 勘误（分镜表 vs 实际 UI，2026-10-10）：
 * - /debug 调试台执行后整页跳转「执行报告」页（SSE 实时），调试台内无独立响应面板——
 *   S4 的「响应区实时回填」实际呈现在 /reports/[taskId]（report-response-body 等），模块按实际动线走。
 * - 请求头与 query 参数同在统一请求编辑器「参数」页签（req-headers-row / req-query-row 同区）。
 */
import { sleep, WEB, MOCK } from "../../scripts/tutor/record-core.mjs";

const HELLO = `${MOCK}/hello`;
const SAVE_API_NAME = "演示-调试沉淀接口";

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

async function fillDur(t0, seconds) {
  const remain = seconds * 1000 - (Date.now() - t0);
  if (remain > 0) await sleep(remain);
}

/** 调试台 → 报告页终态等待（SSE 收敛；SUCCESS/FAILED 皆可，镜头留完整过程）。 */
async function waitReportDone(page) {
  await page.waitForURL(/\/reports\//, { timeout: 15000 }).catch(() => {});
  await page
    .getByTestId("report-status")
    .filter({ hasText: /^(SUCCESS|FAILED|PARTIAL)$/ })
    .first()
    .waitFor({ timeout: 30000 })
    .catch(() => {});
  await sleep(600);
}

export const scenes = [
  {
    seg: "S3",
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/debug");
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(1200);
      await h.narrate("S3");
      // 环境：演示环境（host=mock）
      await h.spotlight(".ant-select", 800).catch(() => {});
      const envSel = page.getByTestId("env-select").first();
      if (await envSel.count()) {
        await envSel.click().catch(() => {});
        const opt = page
          .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
          .getByText("演示环境", { exact: true })
          .first();
        if (await opt.count()) await opt.click();
        await sleep(500);
      }
      // 方法 GET + URL（逐字符拟真键入）
      const method = page.getByTestId("debug-method").first();
      if (await method.count()) {
        await method.click().catch(() => {});
        const opt = page
          .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
          .getByText("GET", { exact: true })
          .first();
        if (await opt.count()) await opt.click();
        await sleep(300);
      }
      await h.zoom('[data-testid="debug-url"]', 1.25, 600);
      await h.type('[data-testid="debug-url"]', HELLO);
      await sleep(400);
      // 参数页签：加一个 query 参数 + 一个请求头（同区两行编辑器）
      if (await tap(page, "req-tab-params")) {
        await page
          .waitForSelector('[data-testid="req-panel-params"]', { timeout: 8000 })
          .catch(() => {});
        await sleep(400);
        await h.zoom('[data-testid="req-panel-params"]', 1.15, 600);
        const addQuery = page.getByTestId("req-query-rows").getByText("＋ 添加").first();
        if (await addQuery.count()) {
          await addQuery.click();
          await sleep(400);
          const q = page.getByTestId("req-query-row").first();
          await q.locator('input[placeholder="key"]').fill("verbose");
          await q.locator('input[placeholder^="value"]').fill("true");
          await sleep(400);
        }
        const addHeader = page.getByTestId("req-headers-rows").getByText("＋ 添加").first();
        if (await addHeader.count()) {
          await addHeader.click();
          await sleep(400);
          const hr = page.getByTestId("req-headers-row").first();
          await hr.locator('input[placeholder="key"]').fill("X-Demo");
          await hr.locator('input[placeholder^="value"]').fill("tutor");
          await sleep(400);
        }
        await h.reset();
      }
      await h.spotlight('[data-testid="btn-execute"]', 1000);
      await fillDur(t0, 40);
    },
  },
  {
    seg: "S4",
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/debug");
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(800);
      await h.narrate("S4");
      await page
        .getByTestId("debug-url")
        .fill(HELLO)
        .catch(() => {});
      // 第一次发送 → 报告页实时回填（状态码/耗时/响应体）
      await page.getByTestId("btn-execute").click();
      await waitReportDone(page);
      await h.spotlight('[data-testid="report-response-body"]', 1800).catch(() => {});
      await h.spotlight('[data-testid="report-asserts"]', 1000).catch(() => {});
      // 二态对比：回调试台改一个参数值重发，两段报告同机位对切（不改运镜）
      const back = page.getByRole("link", { name: "‹ 返回调试" });
      if (await back.count()) {
        await back.click();
        await sleep(800);
        if (await has(page, "req-tab-params")) {
          await page.getByTestId("req-tab-params").click();
          const q = page.getByTestId("req-query-row").first();
          if (await q.count()) await q.locator('input[placeholder^="value"]').fill("false");
          await sleep(500);
        }
        await page.getByTestId("btn-execute").click();
        await waitReportDone(page);
        await h.spotlight('[data-testid="report-response-body"]', 1500).catch(() => {});
        await sleep(600);
      }
      await h.reset();
      await fillDur(t0, 30);
    },
  },
  {
    seg: "S5",
    run: async (page, h) => {
      const t0 = Date.now();
      // 断言：JSONPath $.status contains UP；前置脚本：setVar（quickjs 沙箱，报告页看断言结果与日志）
      await h.goto("/debug");
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(800);
      await h.narrate("S5");
      await page
        .getByTestId("debug-url")
        .fill(HELLO)
        .catch(() => {});
      await h.zoom('[data-testid="debug-asserts"]', 1.15, 600);
      if (await has(page, "btn-add-assert")) {
        await page.getByTestId("btn-add-assert").click();
        await sleep(500);
        const row = page.getByTestId("debug-asserts").locator("> div").nth(1);
        await row.locator(".ant-select").first().click();
        const kindOpt = page
          .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
          .getByText("响应体 JSONPath", { exact: true })
          .first();
        if (await kindOpt.count()) {
          await kindOpt.click();
          await sleep(300);
          await row.locator('input[placeholder="$.url"]').fill("$.status");
          await row.locator('input[placeholder="期望值"]').fill("UP");
          await sleep(400);
        }
        await h.spotlight('[data-testid="debug-asserts"]', 1200);
      }
      // 前置脚本：＋ 添加处理器 → setVar
      if (await tap(page, "req-tab-pre")) {
        await page
          .waitForSelector('[data-testid="req-panel-pre"]', { timeout: 8000 })
          .catch(() => {});
        await sleep(400);
        const add = page
          .getByTestId("req-panel-pre")
          .getByRole("button", { name: "＋ 添加处理器" });
        if (await add.count()) {
          await add.click();
          await sleep(500);
          const ta = page.getByTestId("processor-row-1").locator("textarea").first();
          if (await ta.count()) {
            await h.zoom('[data-testid="processor-row-1"]', 1.3, 600);
            await ta.fill('setVar("who", "tutor")');
            await sleep(500);
          }
        }
      }
      await h.reset();
      // 执行 → 报告页：断言通过（绿）+ 日志（脚本运行留痕）
      await page.getByTestId("btn-execute").click();
      await waitReportDone(page);
      await h.spotlight('[data-testid="report-asserts"]', 1600).catch(() => {});
      await page
        .getByTestId("assert-pass")
        .first()
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      await h.spotlight('[data-testid^="assert-pass"]', 1200).catch(() => {});
      await h.spotlight('[data-testid="report-logs"]', 1200).catch(() => {});
      await fillDur(t0, 45);
    },
  },
  {
    seg: "S6",
    run: async (page, h) => {
      const t0 = Date.now();
      // 「保存为接口」沉淀调试成果 → 接口定义列表特写（幂等：先查重）
      await h.goto("/debug");
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(800);
      await h.narrate("S6");
      await page
        .getByTestId("debug-url")
        .fill(HELLO)
        .catch(() => {});
      await sleep(300);
      const projList = await apiGet(page, "/api/v1/personal/projects");
      const project = (projList ?? []).find((p) => p.name === "管理项目") ?? (projList ?? [])[0];
      let existed = false;
      if (project) {
        const list = await apiGet(
          page,
          `/api/v1/projects/${project.id}/apis?keyword=${encodeURIComponent(SAVE_API_NAME)}&pageSize=20`,
        );
        existed = (list?.items ?? []).some((i) => i.name === SAVE_API_NAME);
      }
      if (await has(page, "btn-save-as-api")) {
        await h.spotlight('[data-testid="btn-save-as-api"]', 1000);
        await page.getByTestId("btn-save-as-api").click();
        await sleep(700);
        const nameInput = page.getByTestId("input-save-api-name").first();
        if (await nameInput.count()) {
          await nameInput.fill(SAVE_API_NAME);
          const modSel = page.getByTestId("select-save-api-module").first();
          if (await modSel.count()) {
            await modSel.click().catch(() => {});
            const opt = page
              .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
              .first()
              .locator(".ant-select-item")
              .first();
            if (await opt.count()) await opt.click();
            await sleep(400);
          }
          if (!existed) {
            const ok = page.getByRole("button", { name: /保\s*存/ }).first();
            if (await ok.count()) await ok.click();
            await page
              .getByText(/已保存为接口/)
              .first()
              .waitFor({ timeout: 8000 })
              .catch(() => {});
          } else {
            // 已存在：弹窗展示后取消，不重复创建
            await page.keyboard.press("Escape");
          }
          await sleep(600);
        }
      }
      // 列表特写：接口定义下已出现
      await h.goto("/apis");
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(1000);
      await h.spotlight('[data-testid="api-list-table"]', 1500).catch(() => {});
      await h.reset();
      await fillDur(t0, 20);
    },
  },
];
