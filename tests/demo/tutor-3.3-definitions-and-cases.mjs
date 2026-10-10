/**
 * 教学视频 3.3 接口定义与接口用例 场景模块（分镜表 S3~S7 录屏镜）。
 * 驱动：node scripts/tutor/record.mjs 3.3
 * 造数前置：node scripts/tutor/prep.mjs（4 个演示接口定义 + 各 1~2 条演示接口用例 + 演示环境）
 *
 * 幂等口径：本集创建的定义/用例/Mock 规则全部「演示-」前缀 + 先查重再建；
 * Swagger 导入若已导入过（keyword 命中）则只演示弹窗流程不落库；批量运行为真实执行（教学重点）。
 * 选择器来源：tests/e2e/API-002/003/005/011（已核对源码 apis/page.tsx、apis/[id]/page.tsx）。
 * 勘误（分镜表 vs 实际 UI，2026-10-10）：
 * - 无独立 /apis/new 路由：列表页「新建接口」弹窗（input-new-name/select-new-method/input-new-path
 *   → 「创建并编辑」）后直接进详情编辑器——S3 按实际动线。
 * - S7「终端 curl 验证」：实际 UI 内置「Mock 调试」弹窗（web 服务端代发，btn-send-mock-debug →
 *   mock-debug-result 命中规则 + 响应体），等价验证且录屏更稳，模块用它替代终端。
 */
import { sleep, WEB } from "../../scripts/tutor/record-core.mjs";

const HAND_API = "演示-手工订单查询";
const SWAGGER_TAG = "演示-Swagger";
const DEMO_API = "演示-用户登录";
const NEW_CASE = "演示-登录-边界参数校验";
const MOCK_RULE = "演示-下单Mock规则";

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

async function findApiDef(page, name) {
  const pid = await projId(page);
  if (!pid) return null;
  const list = await apiGet(
    page,
    `/api/v1/projects/${pid}/apis?keyword=${encodeURIComponent(name)}&pageSize=20`,
  );
  return (list?.items ?? []).find((i) => i.name === name) ?? null;
}

async function pickOption(page, sel, label) {
  const el = page.getByTestId(sel).first();
  if (!(await el.count())) return false;
  try {
    await el.click({ timeout: 5000 });
    const dropdown = page
      .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
      .filter({ visible: true })
      .last();
    await dropdown.waitFor({ state: "visible", timeout: 2500 });
    const opt = dropdown.getByText(label, { exact: true }).first();
    if (!(await opt.count())) return false;
    await opt.click({ timeout: 3000 });
    await sleep(300);
    return true;
  } catch {
    return false;
  }
}

async function fillDur(t0, seconds) {
  const remain = seconds * 1000 - (Date.now() - t0);
  if (remain > 0) await sleep(remain);
}

/** OpenAPI3 演示文档（两个演示接口，summary 带「演示-Swagger」前缀便于查重/清理）。 */
function demoOpenapi() {
  return JSON.stringify({
    openapi: "3.0.0",
    info: { title: "演示-Swagger 订单服务", version: "1.0.0" },
    paths: {
      "/demo-swagger/orders": {
        get: { summary: `${SWAGGER_TAG}-查询订单列表`, parameters: [], responses: {} },
      },
      "/demo-swagger/orders/{id}": {
        post: { summary: `${SWAGGER_TAG}-创建订单`, parameters: [], responses: {} },
      },
    },
  });
}

export const scenes = [
  {
    seg: "S3",
    run: async (page, h) => {
      const t0 = Date.now();
      // 手工创建（弹窗，无 /apis/new 路由）→ 详情编辑器补契约
      await h.goto("/apis");
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(1000);
      await h.narrate("S3");
      const existed = await findApiDef(page, HAND_API);
      if (!existed && (await tap(page, "btn-new-api"))) {
        await page
          .waitForSelector('[data-testid="input-new-name"]', { timeout: 10000 })
          .catch(() => {});
        await h.zoom(".ant-modal", 1.15, 600);
        await h.type('[data-testid="input-new-name"]', HAND_API);
        await sleep(300);
        await pickOption(page, "select-new-method", "POST");
        await page.getByTestId("input-new-path").fill("/demo/orders/query");
        await sleep(400);
        await h.spotlight('[data-testid="input-new-path"]', 900);
        const createBtn = page.getByRole("button", { name: /创建并编辑/ }).first();
        if (await createBtn.count()) await createBtn.click();
        await page.waitForURL(/\/apis\/[a-z0-9-]+/i, { timeout: 12000 }).catch(() => {});
        await sleep(1000);
      }
      // 详情：请求契约（参数/请求体）+ 响应契约（input-resp-status / input-resp-body）
      const def = existed ?? (await findApiDef(page, HAND_API));
      if (def) {
        await h.goto(`/apis/${def.id}`);
        await page
          .waitForSelector('[data-testid="input-api-name"]', { timeout: 12000 })
          .catch(() => {});
        await sleep(800);
        await h.spotlight('[data-testid="input-api-path"]', 1100).catch(() => {});
        if (await tap(page, "req-tab-params")) {
          await sleep(400);
          await h.spotlight('[data-testid="req-panel-params"]', 1000).catch(() => {});
        }
        if (await tap(page, "req-tab-body")) {
          await sleep(400);
          await h.spotlight('[data-testid="req-panel-body"]', 1000).catch(() => {});
        }
        // 响应契约区
        await h.panTo('[data-testid="input-resp-body"]');
        await h.spotlight('[data-testid="input-resp-body"]', 1400).catch(() => {});
      }
      await h.reset();
      await fillDur(t0, 35);
    },
  },
  {
    seg: "S4",
    run: async (page, h) => {
      const t0 = Date.now();
      // Swagger 导入（已导入过则只演示弹窗流程不重复落库）→ 列表批量出现 → 同步配置一眼带过
      await h.goto("/apis");
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(800);
      await h.narrate("S4");
      const imported = await findApiDef(page, `${SWAGGER_TAG}-查询订单列表`);
      if (await tap(page, "btn-import-api")) {
        await page
          .waitForSelector('[data-testid="input-import-content"]', { timeout: 10000 })
          .catch(() => {});
        await sleep(600);
        await h.zoom(".ant-modal", 1.12, 600);
        await page.getByTestId("input-import-content").fill(demoOpenapi());
        await sleep(600);
        await h.spotlight('[data-testid="input-import-content"]', 1000).catch(() => {});
        if (!imported) {
          const go = page.getByRole("button", { name: /开始导入/ }).first();
          if (await go.count()) await go.click();
          await page
            .waitForSelector('[data-testid="import-report"]', { timeout: 15000 })
            .catch(() => {});
          await h.spotlight('[data-testid="import-report"]', 1800).catch(() => {});
          const done = page.getByRole("button", { name: /完\s*成/ }).first();
          if (await done.count()) await done.click();
          await sleep(1000);
        } else {
          await page.keyboard.press("Escape");
          await sleep(400);
        }
      }
      // 列表刷新特写：导入的两个演示接口
      await page.reload();
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(1200);
      if (await has(page, "input-keyword")) {
        await page.getByTestId("input-keyword").fill(SWAGGER_TAG);
        await page.keyboard.press("Enter");
        await sleep(1200);
      }
      await h.spotlight('[data-testid="api-list-table"]', 1600).catch(() => {});
      // /settings/swagger-sync 一眼带过（定时同步配置入口）
      await h.goto("/settings/swagger-sync");
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(900);
      await h.spotlight('[data-testid="page-settings-swagger-sync"]', 1500).catch(() => {});
      await h.spotlight('[data-testid="swagger-create-btn"]', 1000).catch(() => {});
      await h.reset();
      await fillDur(t0, 50);
    },
  },
  {
    seg: "S5",
    run: async (page, h) => {
      const t0 = Date.now();
      // 详情：基本信息 + 当前版本 + 变更记录抽屉（用 prep 的演示-用户登录，已多版本留痕）
      const def = await findApiDef(page, DEMO_API);
      if (def) await h.goto(`/apis/${def.id}`);
      else await h.goto("/apis");
      await page
        .waitForSelector('[data-testid="input-api-name"]', { timeout: 12000 })
        .catch(() => {});
      await sleep(800);
      await h.narrate("S5");
      await h.spotlight('[data-testid="input-api-name"]', 1000).catch(() => {});
      // 当前版本徽标无 testid：以相邻的「变更历史」按钮锚定版本区（spotlight 仅支持 CSS）
      await h.spotlight('[data-testid="btn-api-changes"]', 1200).catch(() => {});
      if (await tap(page, "btn-api-changes")) {
        await page
          .locator(".ant-drawer-content")
          .waitFor({ timeout: 8000 })
          .catch(() => {});
        await sleep(700);
        await h.spotlight(".ant-drawer-content", 1600).catch(() => {});
        await page.keyboard.press("Escape");
        await sleep(400);
      }
      await h.reset();
      await fillDur(t0, 35);
    },
  },
  {
    seg: "S6",
    run: async (page, h) => {
      const t0 = Date.now();
      // CASE 页签：新建第 3 个用例（幂等）→ 勾选 2 条 → 批量运行 → 报告逐条返回
      const def = await findApiDef(page, DEMO_API);
      if (!def) {
        await fillDur(t0, 50);
        return;
      }
      await h.goto(`/apis/${def.id}`);
      await page
        .waitForSelector('[data-testid="input-api-name"]', { timeout: 12000 })
        .catch(() => {});
      await h.narrate("S6");
      if (await tap(page, "api-tab-case")) {
        await page
          .waitForSelector('[data-testid="case-list-table"]', { timeout: 10000 })
          .catch(() => {});
        await sleep(800);
        await h.spotlight('[data-testid="case-list-table"]', 1200).catch(() => {});
        // 新建一个用例（带不同断言；已有则跳过）
        const pidForCases = await projId(page);
        const caseList = pidForCases
          ? await apiGet(page, `/api/v1/projects/${pidForCases}/apis/${def.id}/cases?pageSize=50`)
          : null;
        const caseNames = new Set((caseList?.items ?? []).map((c) => c.name));
        if (!caseNames.has(NEW_CASE) && (await tap(page, "btn-new-case"))) {
          await page
            .locator(".ant-modal")
            .waitFor({ timeout: 8000 })
            .catch(() => {});
          await sleep(600);
          await page.getByTestId("input-new-case-name").fill(NEW_CASE);
          await sleep(400);
          // 新建用例弹窗 okText=创建（内有 btn-save-case 同锚点）
          const ok = page.getByTestId("btn-save-case").first();
          if (await ok.count()) await ok.click();
          else {
            const alt = page
              .getByRole("dialog")
              .getByRole("button", { name: /创\s*建/ })
              .first();
            if (await alt.count()) await alt.click();
          }
          await sleep(1500);
        }
        // 勾选 2 条（前两行）→ 批量执行
        const rows = await page
          .getByTestId("case-list-table")
          .getByRole("row")
          .filter({ hasText: "演示-" })
          .all();
        let checked = 0;
        for (const r of rows.slice(0, 2)) {
          const box = r.locator('input[type="checkbox"]').first();
          if (await box.count()) {
            await box.check().catch(() => {});
            checked += 1;
            await sleep(300);
          }
        }
        if (checked && (await tap(page, "btn-batch-exec"))) {
          const dlg = page.getByRole("dialog");
          await dlg.waitFor({ timeout: 8000 }).catch(() => {});
          await sleep(600);
          // 选演示环境
          const envSel = dlg.getByTestId("env-select").first();
          if (await envSel.count()) {
            await envSel.click().catch(() => {});
            const opt = page
              .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
              .getByText("演示环境", { exact: true })
              .first();
            if (await opt.count()) await opt.click();
            await sleep(400);
          }
          await h.spotlight('[data-testid="btn-batch-exec"]', 800).catch(() => {});
          const submit = dlg.getByRole("button", { name: /提交执行/ }).first();
          if (await submit.count()) await submit.click();
          // 任务中心 → 终态 → 查看报告
          await page.waitForURL(/\/tasks/, { timeout: 15000 }).catch(() => {});
          await sleep(1500);
          const row = page
            .getByTestId("task-list-table")
            .getByRole("row")
            .filter({ hasText: /RUNNING|PENDING|SUCCESS|FAILED|PARTIAL/ })
            .first();
          if (await row.count()) {
            await row
              .getByText(/SUCCESS|FAILED|PARTIAL/, { exact: true })
              .first()
              .waitFor({ timeout: 30000 })
              .catch(() => {});
            await sleep(600);
            const rpt = row.getByRole("button", { name: "查看报告" });
            if (await rpt.count()) {
              await rpt.click();
              await page.waitForURL(/\/reports\//, { timeout: 12000 }).catch(() => {});
              await sleep(1500);
              await h.spotlight('[data-testid="report-summary-cards"]', 1500).catch(() => {});
              await h.spotlight('[data-testid="report-items-table"]', 1500).catch(() => {});
            }
          }
        }
      }
      await h.reset();
      await fillDur(t0, 50);
    },
  },
  {
    seg: "S7",
    run: async (page, h) => {
      const t0 = Date.now();
      // MOCK 页签：Mock 地址 + 规则（幂等）+ 内置 Mock 调试验证命中（替代终端 curl，见文件头勘误）
      const def = await findApiDef(page, "演示-创建订单");
      if (!def) {
        await fillDur(t0, 35);
        return;
      }
      await h.goto(`/apis/${def.id}`);
      await page
        .waitForSelector('[data-testid="input-api-name"]', { timeout: 12000 })
        .catch(() => {});
      await h.narrate("S7");
      if (await tap(page, "api-tab-mock")) {
        await sleep(800);
        await h.spotlight('[data-testid="mock-url-box"]', 1300).catch(() => {});
        await tap(page, "btn-copy-mock-url");
        await sleep(500);
        const table = page.getByTestId("mock-rule-table");
        const hasRule = (await table.count()) && (await table.getByText(MOCK_RULE).count()) > 0;
        if (!hasRule && (await tap(page, "btn-new-mock"))) {
          await page
            .locator(".ant-modal")
            .waitFor({ timeout: 8000 })
            .catch(() => {});
          await sleep(600);
          await h.zoom(".ant-modal", 1.15, 600);
          await page
            .getByTestId("input-mock-name")
            .fill(MOCK_RULE)
            .catch(() => {});
          // 关闭「跟随 API」→ 使用自定义返回体
          const follow = page.getByTestId("switch-mock-follow-api").first();
          if (await follow.count()) {
            const on = await follow
              .locator("..")
              .textContent()
              .catch(() => "");
            if (on.includes("已开启")) await follow.click();
          }
          const drawerBody = page.locator(".ant-modal").locator("textarea").last();
          if (await drawerBody.count()) {
            await drawerBody.fill('{"code":0,"data":{"orderId":"ORD-DEMO-001","payAmount":199}}');
          }
          await sleep(500);
          const ok = page
            .getByRole("dialog")
            .getByRole("button", { name: /保\s*存|确\s*定|创\s*建/ })
            .first();
          if (await ok.count()) await ok.click();
          await sleep(1500);
        }
        // 行内「调试」→ 发送 → 命中规则（响应体与规则一致）
        const dbg = page.locator('[data-testid^="btn-debug-mock-"]').first();
        if (await dbg.count()) {
          await dbg.click();
          await sleep(700);
          if (await has(page, "btn-send-mock-debug")) {
            await h.spotlight('[data-testid="btn-send-mock-debug"]', 800);
            await page.getByTestId("btn-send-mock-debug").click();
            await page
              .waitForSelector('[data-testid="mock-debug-result"]', { timeout: 15000 })
              .catch(() => {});
            await sleep(600);
            await h.spotlight('[data-testid="mock-debug-result"]', 2000).catch(() => {});
          }
        }
      }
      await h.reset();
      await fillDur(t0, 35);
    },
  },
];
