/**
 * 教学视频 7.1 UI 测试 场景模块（分镜表 S3~S9 七个录屏镜）。
 * 驱动：node scripts/tutor/record.mjs 7.1
 * 前置：mock 栈起（/uit/demo :4000）+ node scripts/tutor/prep.mjs（元素库三件套已造）。
 *
 * 演示数据约定：「演示-」前缀 + 存在即复用——
 *   元素：演示-用户名输入框/演示-提交按钮/演示-结果文案（prep.mjs 同名同定位器）；
 *   用例：演示-教程提交链路（步骤五步）/ 演示-脚本导入（okScript）/ 演示-失败演示（failScript 同法）。
 * 选择器事实源：tests/e2e/S11-load-uit.spec.ts（UIT-002 段）+ UIT-003-script.spec.ts + UIT-004-runner.spec.ts。
 */
import { sleep, WEB, MOCK } from "../../scripts/tutor/record-core.mjs";

const DEMO_USER = "demo-rabbit";
const ELEMENT_DEFS = [
  { name: "演示-用户名输入框", locatorType: "testid", locator: "demo-username" },
  { name: "演示-提交按钮", locatorType: "testid", locator: "demo-submit" },
  { name: "演示-结果文案", locatorType: "css", locator: ".demo-result-text" },
];
const STEP_CASE = "演示-教程提交链路";
const SCRIPT_CASE = "演示-脚本导入";
const FAIL_CASE = "演示-失败演示";
const CHECK_KEYS = ["node", "runner_pkg", "chromium", "disk", "ffmpeg", "npm_registry"];

/** 跨镜状态（用例 id / 任务 URL；重录单镜时各镜开头现查兜底）。 */
const S = { stepCaseId: null, scriptTaskUrl: null };

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
  console.warn(`[tutor-7.1] pickOption 未选中「${String(optionText)}」：${lastErr?.message ?? ""}`);
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

async function findCase(page, name) {
  const id = await pid(page);
  if (!id) return null;
  const data = await api(page, "GET", `/api/v1/projects/${id}/ui-cases?pageSize=100`);
  const list = data?.list ?? data?.items ?? [];
  return list.find((c) => c.name === name) ?? null;
}

async function padTo(t0, targetMs) {
  const remain = targetMs - (Date.now() - t0);
  if (remain > 300) await sleep(remain);
}

/** 报告状态轮询（SUCCESS/FAILED；≤timeoutMs）。 */
async function pollReportStatus(page, want, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const txt = (
      await page
        .getByTestId("uit-report-status")
        .innerText()
        .catch(() => "")
    ).trim();
    if (txt === want) return true;
    await sleep(1500);
  }
  return false;
}

async function enterUit(page, h) {
  await h.goto("/ui-test");
  // 页面内授权轮询自然转正（e2e 同口径 60s）
  await page
    .getByTestId("uit-page")
    .waitFor({ state: "visible", timeout: 60000 })
    .catch(() => {});
  await sleep(600);
}

/** UIT-003 okScript 模板（域名=mock 演示栈）。 */
function okScript() {
  return `import { test, expect } from '@playwright/test';
test('脚本提交成功', async ({ page }) => {
  await page.goto('${MOCK}/uit/demo');
  await page.getByTestId('demo-username').fill('${DEMO_USER}');
  await page.getByTestId('demo-submit').click();
  await expect(page.getByTestId('demo-result')).toContainText('提交成功，${DEMO_USER}');
});
test('元素可见', async ({ page }) => {
  await page.goto('${MOCK}/uit/demo');
  await expect(page.getByTestId('demo-username')).toBeVisible();
});`;
}

export const scenes = [
  // ── S3（25s）用例列表：模式列（步骤/脚本）双模式定位 + Runner 胶囊扫过 ──
  {
    seg: "S3",
    run: async (page, h) => {
      const t0 = Date.now();
      try {
        await h.goto("/");
        await sleep(600);
        await h.expandGroup("UI 测试");
        await page
          .getByTestId("nav-uit")
          .first()
          .click()
          .catch(async () => {
            await h.goto("/ui-test");
          });
        await page
          .getByTestId("uit-page")
          .waitFor({ state: "visible", timeout: 60000 })
          .catch(() => {});
        await sleep(800);
        await h.narrate("S3");
        await h.spotlight('[data-testid="uit-cases-table"]', 1500).catch(() => {});
        // 模式列 spotlight（脚本 Tag 紫色 / 步骤 Tag）
        await h.spotlight('[data-testid="uit3-mode-script"]', 1000).catch(() => {});
        // Runner 胶囊（S9 详讲，此处扫过）
        await h.spotlight('[data-testid="uit4-pill"]', 1200).catch(() => {});
        await h.spotlight('[data-testid="uit-create-btn"]', 1000);
        await h.reset();
      } catch (e) {
        console.warn(`[tutor-7.1] S3: ${e.message}`);
      }
      await padTo(t0, 25_000);
    },
  },

  // ── S4（30s）元素库：新建 3 个元素（存在即复用）→ 表格行依次 spotlight ──
  {
    seg: "S4",
    run: async (page, h) => {
      const t0 = Date.now();
      try {
        await h.goto("/ui-test/elements");
        await page
          .getByTestId("uit-elements-page")
          .waitFor({ state: "visible", timeout: 20000 })
          .catch(() => {});
        await sleep(800);
        await h.narrate("S4");
        const table = page.getByTestId("uit-elements-table");
        for (const def of ELEMENT_DEFS) {
          const existed = (await table.innerText().catch(() => "")).includes(def.name);
          if (existed) {
            // 已存在（prep.mjs 同名）：光标滑到行 + 表格 spotlight（复用演示）
            await page
              .locator("tr", { hasText: def.name })
              .first()
              .hover()
              .catch(() => {});
            await sleep(400);
            await h.spotlight(".ant-table-container", 1100).catch(() => {});
            continue;
          }
          await page.getByTestId("uit-element-create").click();
          const dialog = page.getByRole("dialog");
          await dialog.waitFor({ state: "visible", timeout: 8000 });
          await h.spotlight('[data-testid="uit-element-name"]', 900).catch(() => {});
          await page.getByTestId("uit-element-name").locator("input").fill(def.name);
          await pickOption(page, dialog.locator(".ant-select").first(), def.locatorType);
          await page.getByTestId("uit-element-locator").locator("input").fill(def.locator);
          await sleep(300);
          await dialog.getByRole("button", { name: /确 定|OK/ }).click();
          // 完成信号=表格行出现（toast 竞态，e2e 教训）
          await page
            .getByText(def.name)
            .first()
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => {});
          await sleep(300);
        }
        // 表格行依次 spotlight（用户名/提交/结果三行）
        await h.zoom(".ant-table-container", 1.12, 700).catch(() => {});
        await sleep(500);
        await h.reset();
      } catch (e) {
        console.warn(`[tutor-7.1] S4: ${e.message}`);
      }
      await padTo(t0, 30_000);
    },
  },

  // ── S5（45s）步骤模式建用例：切模式（确认弹窗）→ goto/fill/click/assert/screenshot 五步 → 保存 ──
  {
    seg: "S5",
    run: async (page, h) => {
      const t0 = Date.now();
      try {
        await enterUit(page, h);
        await h.narrate("S5");
        const existed = await findCase(page, STEP_CASE);
        if (existed?.id) {
          // 存在即复用：列表行与摘要 spotlight（摘要列显示 goto→fill→click→… 操作链）
          S.stepCaseId = existed.id;
          await page
            .locator("tr", { hasText: STEP_CASE })
            .first()
            .hover()
            .catch(() => {});
          await sleep(400);
          await h.spotlight('[data-testid="uit-cases-table"]', 1600).catch(() => {});
          await h.reset();
          return;
        }
        await page.getByTestId("uit-create-btn").click();
        await page
          .getByTestId("uit-case-form")
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => {});
        await sleep(600);
        // 新建默认脚本模式（S13 起）——切「步骤模式」+ 确认弹窗（双模式叙事关键交互，完整入镜）
        await h.spotlight('[data-testid="uit3-mode-segmented"]', 1200);
        await page
          .getByTestId("uit3-mode-segmented")
          .getByText("步骤模式", { exact: true })
          .click();
        await sleep(400);
        await page.getByRole("button", { name: "确认切换" }).click();
        await page
          .getByTestId("uit-step-editor")
          .waitFor({ state: "visible", timeout: 8000 })
          .catch(() => {});
        await page.getByRole("textbox", { name: "用例名称" }).fill(STEP_CASE);
        // 步骤 1：goto（默认首行）
        await h.spotlight('[data-testid="uit-step-op-0"]', 900);
        await page.getByPlaceholder("http(s) 绝对 URL").fill(`${MOCK}/uit/demo`);
        // 步骤 2：fill（用户名输入框 ← demo-rabbit）
        await page.getByTestId("uit-add-step").click();
        await pickOption(
          page,
          page.getByTestId("uit-step-op-1").locator(".ant-select").first(),
          "fill（填写输入）",
        );
        await pickOption(
          page,
          page.getByTestId("uit-step-element-1").locator(".ant-select").first(),
          /用户名输入框/,
        );
        await h.spotlight('[data-testid="uit-step-element-1"]', 900).catch(() => {});
        await page.getByPlaceholder("填写值").fill(DEMO_USER);
        // 步骤 3：click（提交按钮）
        await page.getByTestId("uit-add-step").click();
        await pickOption(
          page,
          page.getByTestId("uit-step-op-2").locator(".ant-select").first(),
          "click（点击元素）",
        );
        await pickOption(
          page,
          page.getByTestId("uit-step-element-2").locator(".ant-select").first(),
          /提交按钮/,
        );
        // 步骤 4：assert-text（结果文案 期望 提交成功）
        await page.getByTestId("uit-add-step").click();
        await pickOption(
          page,
          page.getByTestId("uit-step-op-3").locator(".ant-select").first(),
          "assert-text（断言文案）",
        );
        await pickOption(
          page,
          page.getByTestId("uit-step-element-3").locator(".ant-select").first(),
          /结果文案/,
        );
        await page.getByPlaceholder("期望包含的文案").fill(`提交成功，${DEMO_USER}`);
        // 步骤 5：screenshot（终态截图）
        await page.getByTestId("uit-add-step").click();
        await pickOption(
          page,
          page.getByTestId("uit-step-op-4").locator(".ant-select").first(),
          "screenshot（截图）",
        );
        await sleep(300);
        await h.zoom('[data-testid="uit-step-editor"]', 1.1, 700); // 步骤编辑器逐行扫过
        await sleep(700);
        await h.reset();
        await page.getByTestId("uit-save-btn").click();
        await page.waitForURL(/\/ui-test$/, { timeout: 10000 }).catch(() => {});
        await page
          .getByText(STEP_CASE)
          .first()
          .waitFor({ state: "visible", timeout: 10000 })
          .catch(() => {});
        await sleep(600);
      } catch (e) {
        console.warn(`[tutor-7.1] S5: ${e.message}`);
      }
      await padTo(t0, 45_000);
    },
  },

  // ── S6（40s）执行与报告：行内「执行」→ 任务页 SUCCESS → 步骤行 ✓ → 截图网格 ──
  {
    seg: "S6",
    run: async (page, h) => {
      const t0 = Date.now();
      try {
        await enterUit(page, h);
        await h.narrate("S6");
        const row = page.locator("tr", { hasText: STEP_CASE }).first();
        await row.getByTestId(/^uit-run-/).click();
        await page.waitForURL(/\/ui-test\/tasks\//, { timeout: 15000 }).catch(() => {});
        await page
          .getByTestId("uit-report-page")
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => {});
        // 状态 SUCCESS（chromium 真执行，≤120s）
        await pollReportStatus(page, "SUCCESS", 120_000);
        await h.spotlight('[data-testid="uit-report-status"]', 1400);
        // 步骤行（断言行显示实际值）
        await page
          .getByText(`提交成功，${DEMO_USER}`)
          .first()
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => {});
        await h.spotlight('main, [data-testid="uit-report-page"]', 1000).catch(() => {});
        // 截图网格
        const shots = page.locator('[data-testid^="uit-report-shot-"]');
        await shots
          .first()
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => {});
        await h.zoom('[data-testid="uit-report-shots"]', 1.15, 700).catch(() => {});
        await sleep(600);
        await h.reset();
      } catch (e) {
        console.warn(`[tutor-7.1] S6: ${e.message}`);
      }
      await padTo(t0, 40_000);
    },
  },

  // ── S7（40s）脚本模式：粘贴导入（校验创建）→ 执行 → 测试树 + trace 下载卡（hover 不点击） ──
  {
    seg: "S7",
    run: async (page, h) => {
      const t0 = Date.now();
      try {
        await enterUit(page, h);
        await h.narrate("S7");
        const existed = await findCase(page, SCRIPT_CASE);
        if (!existed) {
          await page.getByTestId("uit3-paste-import").click();
          const dialog = page.getByRole("dialog");
          await dialog.waitFor({ state: "visible", timeout: 8000 });
          await h.spotlight('[role="dialog"]', 1000).catch(() => {});
          await dialog.getByPlaceholder("用例名称（默认取脚本内首个 test 标题）").fill(SCRIPT_CASE);
          await page.getByTestId("uit3-paste-textarea").fill(okScript());
          await sleep(400);
          await page.getByTestId("uit3-paste-create").click(); // 平台校验干跑 → 创建
          await dialog.waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
        }
        // 列表行（模式列=脚本）→ 行内执行
        await page
          .getByText(SCRIPT_CASE)
          .first()
          .waitFor({ state: "visible", timeout: 10000 })
          .catch(() => {});
        const row = page.locator("tr", { hasText: SCRIPT_CASE }).first();
        await row.hover().catch(() => {});
        await sleep(400);
        await h.spotlight('[data-testid="uit-cases-table"]', 1000).catch(() => {});
        await row.getByTestId(/^uit-run-/).click();
        await page.waitForURL(/\/ui-test\/tasks\//, { timeout: 15000 }).catch(() => {});
        S.scriptTaskUrl = page.url();
        await pollReportStatus(page, "SUCCESS", 120_000);
        // 测试树逐用例展开（两个 test）
        await page
          .getByText("脚本提交成功")
          .first()
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => {});
        await page
          .getByText("元素可见")
          .first()
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => {});
        await h.spotlight('[data-testid="uit-report-status"]', 1200);
        // trace 卡：hover 不点击（下载面板不入镜）
        const trace = page.locator('[data-testid^="uit3-trace-dl-"]').first();
        await trace.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
        await trace.hover({ timeout: 6000 }).catch(() => {});
        await sleep(1200);
        await h.spotlight('a[data-testid^="uit3-trace-dl-"]', 1400).catch(() => {});
        await h.reset();
      } catch (e) {
        console.warn(`[tutor-7.1] S7: ${e.message}`);
      }
      await padTo(t0, 40_000);
    },
  },

  // ── S8（20s）失败二态：断言失败用例 → FAILED → 展开失败行（错误代码帧）+ 失败现场截图 ──
  {
    seg: "S8",
    run: async (page, h) => {
      const t0 = Date.now();
      try {
        const p = await pid(page);
        const existed = await findCase(page, FAIL_CASE);
        if (!existed && p) {
          // failScript 同法（错误期望文案制造失败——全系列二态演示口径）
          await api(page, "POST", `/api/v1/projects/${p}/ui-cases`, {
            name: FAIL_CASE,
            steps: [
              { op: "goto", url: `${MOCK}/uit/demo` },
              { op: "click", locator: { locatorType: "testid", locator: "demo-submit" } },
              {
                op: "assert-text",
                expected: "提交成功，never-match",
                locator: { locatorType: "css", locator: ".demo-result-text" },
              },
            ],
          });
        }
        await enterUit(page, h);
        await h.narrate("S8");
        const row = page.locator("tr", { hasText: FAIL_CASE }).first();
        await row.getByTestId(/^uit-run-/).click();
        await page.waitForURL(/\/ui-test\/tasks\//, { timeout: 15000 }).catch(() => {});
        await pollReportStatus(page, "FAILED", 120_000);
        await h.spotlight('[data-testid="uit-report-status"]', 1000);
        // 展开失败行：期望/实际对比 + 错误代码帧（高亮出错行）
        const expand = page.getByTestId(/^uit3-expand-error-/).first();
        await expand.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
        await expand.click();
        const frame = page.locator('[data-testid^="uit3-error-frame-"]').first();
        await frame.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
        await h.spotlight('div[data-testid^="uit3-error-frame-"]', 1600).catch(() => {});
        // 失败现场截图（screenshot=only-on-failure 自动帧）
        const shots = page.locator('[data-testid^="uit-report-shot-"]');
        await shots
          .first()
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => {});
        await sleep(600);
        await h.reset();
      } catch (e) {
        console.warn(`[tutor-7.1] S8: ${e.message}`);
      }
      await padTo(t0, 20_000);
    },
  },

  // ── S9（35s）Runner：胶囊开抽屉 → 系统 Runner 卡 → 触发自检 → 六项 checklist + 「检测于」 ──
  {
    seg: "S9",
    run: async (page, h) => {
      const t0 = Date.now();
      try {
        await enterUit(page, h);
        await h.narrate("S9");
        await h.spotlight('[data-testid="uit4-pill"]', 1200);
        await page.getByTestId("uit4-pill").click();
        const drawer = page.getByTestId("uit4-drawer");
        await drawer.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
        // 系统 Runner 卡（内置恒在）
        await page
          .getByTestId("uit4-runner-builtin")
          .waitFor({ state: "visible", timeout: 8000 })
          .catch(() => {});
        await h.spotlight('[data-testid="uit4-runner-builtin"]', 1400);
        const p = await pid(page);
        // 触发环境自检（抽屉内「环境检测」按钮——真实下发；录制时真跑）
        const checkBtn = page
          .getByTestId("uit4-runner-builtin")
          .getByRole("button", { name: "环境检测" });
        if (await checkBtn.count().catch(() => 0)) {
          await checkBtn.click();
          await sleep(1500);
        }
        // 轮询 checklist 就绪（引擎实测回调，≤30s；e2e T02 同法）
        if (p) {
          const deadline = Date.now() + 30_000;
          while (Date.now() < deadline) {
            const list = await api(page, "GET", `/api/v1/projects/${p}/ui-runners`);
            if (list?.items?.[0]?.check?.items?.length) break;
            await sleep(1500);
          }
        }
        // 重开抽屉渲染六项（reload 后 drawer 状态重置）
        await page.reload();
        await page
          .getByTestId("uit-page")
          .waitFor({ state: "visible", timeout: 60000 })
          .catch(() => {});
        await sleep(600);
        await page.getByTestId("uit4-pill").click();
        await page
          .getByTestId("uit4-runner-builtin")
          .waitFor({ state: "visible", timeout: 8000 })
          .catch(() => {});
        for (const key of CHECK_KEYS) {
          await page
            .getByTestId(`uit4-check-${key}`)
            .first()
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => {});
          await h.spotlight(`div[data-testid="uit4-check-${key}"]`, 900).catch(() => {});
        }
        // 「检测于」时间戳 + 项目级 Runner 安装入口（一句带过，不实装）
        await h.spotlight('[data-testid="uit4-drawer"]', 1000).catch(() => {});
        await h.spotlight('[data-testid="uit4-install-open"]', 900).catch(() => {});
        await h.reset();
      } catch (e) {
        console.warn(`[tutor-7.1] S9: ${e.message}`);
      }
      await padTo(t0, 35_000);
    },
  },
];
