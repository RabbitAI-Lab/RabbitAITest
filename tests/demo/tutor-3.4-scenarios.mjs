/**
 * 教学视频 3.4 接口自动化场景 场景模块（分镜表 S3~S8 录屏镜）。
 * 驱动：node scripts/tutor/record.mjs 3.4
 * 造数前置：node scripts/tutor/prep.mjs（演示-下单主链路 场景：查询商品列表/提交订单/领取优惠券
 *   （断言失败演示）三步，含一次 SUCCESS 与一次含失败项的报告）
 *
 * 幂等口径：新建场景「演示-下单链路场景」先查重再建；步骤保存仅在场景步骤为空时执行；
 * 变量提取/禁用等编辑动作保持客户端态不保存（不污染演示场景）；jmx 只预览不导入；
 * 误报规则「演示-网关502抖动」先查重再建；S6 对演示场景真实执行一次（教学重点，接受重录追加任务）。
 * 选择器来源：tests/e2e/API-006/007/009/010（已核对源码 scenarios/page.tsx、scenarios/[id]/page.tsx、
 * components/scenario/StepTreePanel.tsx、StepConfigEditor.tsx）。
 * 勘误（分镜表 vs 实际 UI，2026-10-10）：
 * - 无 /scenarios/new 路由与「拖拽画布」：列表页「新建场景」弹窗 → /scenarios/[id] 编辑页，
 *   步骤经「＋ 添加根步骤」下拉菜单添加（自定义/循环/脚本/条件等）——S3 按实际动线。
 * - 「依赖线」不存在：步骤顺序即执行顺序，失败策略在步骤配置 select-step-override-onfail；
 *   S5 以「失败策略 + 禁用置灰二态」呈现。
 */
import { sleep, WEB, MOCK } from "../../scripts/tutor/record-core.mjs";

const SCEN_NAME = "演示-下单链路场景";
const MAIN_SCEN = "演示-下单主链路";
const FA_RULE = "演示-网关502抖动";
const FAIL_STEP = "领取优惠券";

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

async function findScenario(page, name) {
  const pid = await projId(page);
  if (!pid) return null;
  const list = await apiGet(page, `/api/v1/projects/${pid}/scenarios?pageSize=100`);
  return (list?.items ?? []).find((i) => i.name === name) ?? null;
}

async function fillDur(t0, seconds) {
  const remain = seconds * 1000 - (Date.now() - t0);
  if (remain > 0) await sleep(remain);
}

/** 步骤树里按名称点选步骤行（step-name-{uid} 反查 uid 不可得——按文本匹配行）。 */
async function clickStepByName(page, name) {
  const row = page.locator('[data-testid^="step-row-"]').filter({ hasText: name }).first();
  if (await row.count()) {
    await row.click().catch(() => {});
    await sleep(600);
    return true;
  }
  return false;
}

export const scenes = [
  {
    seg: "S3",
    run: async (page, h) => {
      const t0 = Date.now();
      // 新建场景（弹窗，幂等）→ 编辑页编排（下拉添加：自定义/循环/脚本，非拖拽画布）
      await h.goto("/scenarios");
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(1000);
      await h.narrate("S3");
      let scen = await findScenario(page, SCEN_NAME);
      if (!scen && (await tap(page, "btn-new-scenario"))) {
        await page
          .waitForSelector('[data-testid="input-new-scenario-name"]', { timeout: 10000 })
          .catch(() => {});
        await sleep(500);
        await h.type('[data-testid="input-new-scenario-name"]', SCEN_NAME);
        await sleep(400);
        const create = page.getByRole("button", { name: /创\s*建/ }).first();
        if (await create.count()) await create.click();
        await page
          .waitForSelector('[data-testid="step-tree-panel"]', { timeout: 12000 })
          .catch(() => {});
        await sleep(800);
        scen = await findScenario(page, SCEN_NAME);
      }
      if (scen) {
        await h.goto(`/scenarios/${scen.id}`);
        await page
          .waitForSelector('[data-testid="step-tree-panel"]', { timeout: 12000 })
          .catch(() => {});
        await sleep(800);
        await h.spotlight('[data-testid="step-tree-panel"]', 1200).catch(() => {});
        // 已有步骤（重录）则不再重复添加/保存（stepCount 以详情接口为准）
        const pidS3 = await projId(page);
        const detail = pidS3
          ? ((await apiGet(page, `/api/v1/projects/${pidS3}/scenarios/${scen.id}`)) ?? {})
          : {};
        const stepCount = detail.stepCount ?? 0;
        if (!stepCount && (await has(page, "btn-add-root-step"))) {
          // ① 自定义请求步骤（填 mock 地址）
          await page.getByTestId("btn-add-root-step").click();
          const itemCustom = page
            .locator(".ant-dropdown-menu-item")
            .filter({ hasText: "自定义步骤" })
            .first();
          if (await itemCustom.count()) {
            await itemCustom.click();
            await sleep(700);
            const url = page.getByTestId("req-url").first();
            if (await url.count()) await url.fill(`${MOCK}/hello`);
            await sleep(400);
          }
          // ② 循环步骤
          await page
            .getByTestId("btn-add-root-step")
            .click()
            .catch(() => {});
          const itemLoop = page
            .locator(".ant-dropdown-menu-item")
            .filter({ hasText: "循环步骤" })
            .first();
          if (await itemLoop.count()) {
            await itemLoop.click();
            await sleep(700);
            await page
              .getByTestId("input-loop-count")
              .fill("2")
              .catch(() => {});
            await sleep(400);
          }
          // ③ 脚本步骤
          await page
            .getByTestId("btn-add-root-step")
            .click()
            .catch(() => {});
          const itemScript = page
            .locator(".ant-dropdown-menu-item")
            .filter({ hasText: "脚本步骤" })
            .first();
          if (await itemScript.count()) {
            await itemScript.click();
            await sleep(700);
            await page
              .getByTestId("input-step-script")
              .fill('setVar("trace", "demo")')
              .catch(() => {});
            await sleep(400);
          }
          await h.spotlight('[data-testid="btn-save-scenario"]', 1000).catch(() => {});
          if (await has(page, "btn-save-scenario")) {
            await page.getByTestId("btn-save-scenario").click();
            await page
              .getByText(/已保存（v\d+）/)
              .first()
              .waitFor({ timeout: 10000 })
              .catch(() => {});
            await sleep(800);
          }
        }
      }
      await h.reset();
      await fillDur(t0, 50);
    },
  },
  {
    seg: "S4",
    run: async (page, h) => {
      const t0 = Date.now();
      // 变量链路：请求步骤「后置·提取」配置 token → 下游步骤 URL 引用 ${token}（编辑态演示，不保存）
      const scen = (await findScenario(page, MAIN_SCEN)) ?? (await findScenario(page, SCEN_NAME));
      if (!scen) {
        await fillDur(t0, 40);
        return;
      }
      await h.goto(`/scenarios/${scen.id}`);
      await page
        .waitForSelector('[data-testid="step-tree-panel"]', { timeout: 12000 })
        .catch(() => {});
      await sleep(800);
      await h.narrate("S4");
      // ① 提取配置：选中首个请求步骤 → 后置页签 → 添加提取（表达式 $.status → token）
      if (await clickStepByName(page, "查询商品列表")) {
        if (await tap(page, "req-tab-post")) {
          await page
            .waitForSelector('[data-testid="req-panel-post"]', { timeout: 8000 })
            .catch(() => {});
          await sleep(500);
          await h.spotlight('[data-testid="req-panel-post"]', 1200).catch(() => {});
          const add = page
            .getByTestId("req-panel-post")
            .getByRole("button", { name: "＋ 添加提取" });
          if (await add.count()) {
            await add.click();
            await sleep(500);
            const er = page.getByTestId("extract-row").first();
            await er.locator('input[placeholder^="表达式"]').fill("$.status");
            await er.locator('input[placeholder="变量名"]').fill("token");
            await sleep(400);
            await h.spotlight('[data-testid="extract-row"]', 1400).catch(() => {});
          }
        }
      }
      // ② 引用处：下游「提交订单」步骤 URL 追加 ${token}（客户端态演示）
      if (await clickStepByName(page, "提交订单")) {
        const url = page.getByTestId("req-url").first();
        if (await url.count()) {
          const cur = await url.inputValue().catch(() => "");
          await url.fill(`${cur.split("?")[0]}?token=\${token}`);
          await sleep(500);
          await h.spotlight('[data-testid="req-url"]', 1400).catch(() => {});
        }
      }
      // ③ 参数页签 + 变量视图（渲染优先级）
      if (await tap(page, "scenario-tab-params")) {
        await page
          .waitForSelector('[data-testid="scenario-params-panel"]', { timeout: 8000 })
          .catch(() => {});
        await sleep(600);
        await h.spotlight('[data-testid="btn-vars-view"]', 900).catch(() => {});
        await tap(page, "btn-vars-view");
        await sleep(900);
      }
      await h.reset();
      await fillDur(t0, 40);
    },
  },
  {
    seg: "S5",
    run: async (page, h) => {
      const t0 = Date.now();
      // 依赖/顺序与开关：失败策略配置 + 步骤禁用置灰二态（客户端态，不保存）
      const scen = (await findScenario(page, MAIN_SCEN)) ?? (await findScenario(page, SCEN_NAME));
      if (!scen) {
        await fillDur(t0, 25);
        return;
      }
      await h.goto(`/scenarios/${scen.id}`);
      await page
        .waitForSelector('[data-testid="step-tree-panel"]', { timeout: 12000 })
        .catch(() => {});
      await sleep(700);
      await h.narrate("S5");
      // 失败策略（步骤级 override）
      if (await clickStepByName(page, "提交订单")) {
        await h.spotlight('[data-testid="select-step-override-onfail"]', 1500).catch(() => {});
      }
      // 禁用二态：hover 行 → 「禁」开关 → 置灰（opacity-50 + 划线）→ 恢复
      const row = page
        .locator('[data-testid^="step-row-"]')
        .filter({ hasText: "提交订单" })
        .first();
      if (await row.count()) {
        await row.hover();
        await sleep(400);
        const dis = row.getByRole("button", { name: /禁用|启用/ }).first();
        if (await dis.count()) {
          await h.zoom('[data-testid^="step-row-"]', 1.2, 600);
          await dis.click(); // 禁用 → 置灰
          await sleep(1100);
          await h.spotlight('[data-testid^="step-row-"]', 900).catch(() => {});
          await dis.click(); // 启用 → 恢复（不留脏态）
          await sleep(700);
        }
      }
      await h.reset();
      await fillDur(t0, 25);
    },
  },
  {
    seg: "S6",
    run: async (page, h) => {
      const t0 = Date.now();
      // 调试执行：演示-下单主链路（第 3 步断言故意失败 → 步骤树红态；前两步绿）
      const scen = await findScenario(page, MAIN_SCEN);
      if (!scen) {
        await fillDur(t0, 40);
        return;
      }
      await h.goto(`/scenarios/${scen.id}`);
      await page
        .waitForSelector('[data-testid="input-scenario-name"]', { timeout: 12000 })
        .catch(() => {});
      await sleep(800);
      await h.narrate("S6");
      // 头部 EnvSelect 选演示环境 → 执行（无弹窗：提交任务后自动 router.push 报告页）
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
      await h.spotlight('[data-testid="btn-exec-scenario"]', 1000).catch(() => {});
      if (await has(page, "btn-exec-scenario")) {
        await page.getByTestId("btn-exec-scenario").click();
        // 报告页：步骤树逐个点亮 → 终态（SUCCESS/FAILED 皆保留完整过程）
        await page.waitForURL(/\/reports\//, { timeout: 15000 }).catch(() => {});
        await page
          .getByTestId("report-status")
          .first()
          .waitFor({ timeout: 15000 })
          .catch(() => {});
        await sleep(1000);
        await h.spotlight('[data-testid="scenario-summary-cards"]', 1400).catch(() => {});
        const tree = page.getByTestId("scenario-tree-card");
        if (await tree.count()) {
          await h.spotlight('[data-testid="scenario-tree-card"]', 1600).catch(() => {});
          // 失败步骤下钻：红在哪一步、为什么红
          const failNode = page
            .locator('[data-testid^="tree-node-"]')
            .filter({ hasText: FAIL_STEP })
            .first();
          if (await failNode.count()) {
            await failNode.click();
            await page
              .waitForSelector('[data-testid="step-drill-panel"]', { timeout: 10000 })
              .catch(() => {});
            await sleep(700);
            await h.spotlight('[data-testid="step-drill-panel"]', 1800).catch(() => {});
          }
        }
      }
      await h.reset();
      await fillDur(t0, 40);
    },
  },
  {
    seg: "S7",
    run: async (page, h) => {
      const t0 = Date.now();
      // jmx 导入：上传演示 jmx → 预览卡（格式探测 jmx）→ 不点导入（重录不堆积场景）
      await h.goto("/scenarios");
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(800);
      await h.narrate("S7");
      if (await tap(page, "btn-import-scenario")) {
        await page
          .waitForSelector('[data-testid="input-import-file"]', { timeout: 10000 })
          .catch(() => {});
        await sleep(600);
        await h.zoom(".ant-modal", 1.15, 600);
        const jmx = `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2">
  <TestPlan testname="tutor-demo" enabled="true"></TestPlan>
  <hashTree>
    <ThreadGroup testname="TG" enabled="true"></ThreadGroup>
    <hashTree>
      <HTTPSamplerProxy testname="演示-导入注册请求" enabled="true">
        <stringProp name="HTTPSampler.method">POST</stringProp>
        <stringProp name="HTTPSampler.domain">127.0.0.1</stringProp>
        <stringProp name="HTTPSampler.port">4000</stringProp>
        <stringProp name="HTTPSampler.path">/perf/echo</stringProp>
      </HTTPSamplerProxy>
      <hashTree/>
    </hashTree>
  </hashTree>
</jmeterTestPlan>`;
        await page.setInputFiles('[data-testid="input-import-file"]', {
          name: "tutor-demo.jmx",
          mimeType: "application/xml",
          buffer: Buffer.from(jmx, "utf8"),
        });
        await page
          .waitForSelector('[data-testid="import-preview"]', { timeout: 12000 })
          .catch(() => {});
        await sleep(800);
        await h.spotlight('[data-testid="import-preview"]', 1800).catch(() => {});
        await page.keyboard.press("Escape");
        await sleep(400);
      }
      await h.reset();
      await fillDur(t0, 15);
    },
  },
  {
    seg: "S8",
    run: async (page, h) => {
      const t0 = Date.now();
      // /scenarios/false-alarm：新建误报规则（幂等）——匹配已知错误码/响应体，执行时自动标记
      await h.goto("/scenarios/false-alarm");
      await page
        .waitForSelector('[data-testid="fa-rules-table"]', { timeout: 12000 })
        .catch(() => {});
      await sleep(800);
      await h.narrate("S8");
      const pid = await projId(page);
      let existed = false;
      if (pid) {
        const rules = await apiGet(page, `/api/v1/projects/${pid}/false-alarm-rules`);
        existed = (rules?.list ?? rules?.items ?? []).some((r) => r.name === FA_RULE);
      }
      if (await has(page, "btn-new-fa-rule")) {
        await h.spotlight('[data-testid="btn-new-fa-rule"]', 900).catch(() => {});
        await page.getByTestId("btn-new-fa-rule").click();
        await page
          .locator(".ant-drawer-content-wrapper")
          .waitFor({ timeout: 8000 })
          .catch(() => {});
        await sleep(600);
        await h.zoom(".ant-drawer-content-wrapper", 1.12, 600);
        await page.getByTestId("input-fa-name").fill(FA_RULE);
        await sleep(300);
        await page
          .getByTestId("input-fa-body")
          .fill("known-issue")
          .catch(() => {});
        await sleep(300);
        await h.spotlight('[data-testid="switch-fa-status"]', 900).catch(() => {});
        if (!existed && (await has(page, "btn-save-fa-rule"))) {
          await page.getByTestId("btn-save-fa-rule").click();
          await page
            .getByText(/已创建|已保存/)
            .first()
            .waitFor({ timeout: 8000 })
            .catch(() => {});
          await sleep(800);
        } else {
          // 已有规则：表单展示后收起，重录不重复创建
          await page.keyboard.press("Escape");
          await sleep(400);
        }
      }
      await h.spotlight('[data-testid="fa-rules-table"]', 1300).catch(() => {});
      await h.reset();
      await fillDur(t0, 20);
    },
  },
];
