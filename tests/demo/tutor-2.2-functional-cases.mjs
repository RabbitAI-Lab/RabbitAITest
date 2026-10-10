/**
 * 教学视频 2.2 功能用例 场景模块（分镜表 S3~S7 录屏镜）。
 * 驱动：node scripts/tutor/record.mjs 2.2
 * 造数前置：node scripts/tutor/prep.mjs（演示模块树 + 10 条「演示-」用例）
 *
 * 本集创建/操作的数据均带「演示-」前缀且幂等（先查重再建，重录不重复堆积）：
 * - 演示-登录安全校验（S3 创建 / S4 详情 / S6 依赖 / S7 删除→回收站恢复）
 * 选择器来源：tests/e2e/CASE-001/002/003/007（已核对源码）。
 * 勘误（分镜表 vs 实际 UI，2026-10-10）：
 * - 新建用例无独立 /cases/new 路由——列表页「新建用例」按钮原地展开表单（cases/page.tsx case-form）。
 * - 「测试点：从用例拆出测试点」不在用例详情页——测试点（测试规划）挂在测试计划详情（PLAN-002），
 *   S6 以「依赖 + 关联计划 Tab」替代呈现。
 */
import { sleep, WEB } from "../../scripts/tutor/record-core.mjs";

const CASE_NAME = "演示-登录安全校验";
const DEP_NAME = "演示-密码错误提示";

/** 守卫点击/操作：元素不存在就跳过（教学录制不因小元素改名而全挂）。 */
async function tap(page, sel, { timeout = 6000, byRole = false } = {}) {
  try {
    const el = byRole ? page.locator(sel).first() : page.getByTestId(sel).first();
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

/** antd Select 选项选择（dropdown 定位与 e2e s2-helpers.pickOption 同口径）。 */
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

/** 只读 API 查询（page.request 复用录屏上下文 admin cookie）。 */
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

async function findDemoCase(page, name) {
  const data = await apiGet(page, `/api/v1/personal/projects`);
  const project = (data ?? []).find((p) => p.name === "管理项目") ?? (data ?? [])[0];
  if (!project) return null;
  const list = await apiGet(
    page,
    `/api/v1/projects/${project.id}/cases?keyword=${encodeURIComponent(name)}&pageSize=20`,
  );
  return (list?.items ?? []).find((i) => i.name === name) ?? null;
}

/** 镜时长兜底：保证录屏段 ≥ 分镜表时长（narrate 已含在 t0 计时内）。 */
async function fillDur(t0, seconds) {
  const remain = seconds * 1000 - (Date.now() - t0);
  if (remain > 0) await sleep(remain);
}

export const scenes = [
  {
    seg: "S3",
    run: async (page, h) => {
      const t0 = Date.now();
      // 列表全景 1s → 新建表单（无 /cases/new 独立路由，列表页原地展开）
      await h.goto("/cases");
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(1200);
      await h.narrate("S3");
      const existed = await findDemoCase(page, CASE_NAME);
      if (existed) {
        // 重录幂等：已存在则走「搜索定位 → 进详情」路径，不重复创建
        if (await has(page, "input-keyword")) {
          await page.getByTestId("input-keyword").fill(CASE_NAME);
          await page.keyboard.press("Enter");
          await sleep(1200);
        }
      } else if (await tap(page, "btn-new-case")) {
        await page.waitForSelector('[data-testid="case-form"]', { timeout: 10000 }).catch(() => {});
        await h.zoom('[data-testid="case-form"]', 1.18, 600);
        await h.type('[data-testid="case-name"]', CASE_NAME);
        await sleep(300);
        await h.type('[data-testid="case-precondition"]', "演示账号已注册且未被锁定");
        await sleep(300);
        // 3 步骤（btn-add-step 两次，默认 1 行已有）
        if (await has(page, "btn-add-step")) {
          await page.getByTestId("btn-add-step").click();
          await page
            .getByTestId("btn-add-step")
            .click()
            .catch(() => {});
          await sleep(400);
        }
        await page.getByTestId("step-desc-1").fill("连续输错密码 5 次后再次登录");
        await page.getByTestId("step-expect-1").fill("提示「账号已锁定 15 分钟」");
        await page.getByTestId("step-desc-2").fill("用正确密码在锁定期内登录");
        await page.getByTestId("step-expect-2").fill("登录被拒绝且不跳转");
        await sleep(400);
        await h.spotlight('[data-testid="btn-save-case"]', 1200);
        await page.getByTestId("btn-save-case").click();
        await page.waitForURL(/\/cases$/, { timeout: 12000 }).catch(() => {});
        await page
          .getByText("已创建")
          .first()
          .waitFor({ timeout: 8000 })
          .catch(() => {});
        await sleep(800);
      }
      await h.reset();
      await fillDur(t0, 45);
    },
  },
  {
    seg: "S4",
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/cases");
      await page.waitForLoadState("networkidle").catch(() => {});
      await h.narrate("S4");
      // 搜索 → 点编号链接进「查看态」详情（名称链接是 edit=1 编辑态，CASE-003 口径）
      if (await has(page, "input-keyword")) {
        await page.getByTestId("input-keyword").fill(CASE_NAME);
        await page.keyboard.press("Enter");
        await sleep(1200);
      }
      const row = page.getByRole("row", { name: new RegExp(CASE_NAME) });
      const numLink = row.getByRole("link", { name: /^C-\d{4,}$/ }).first();
      if (await numLink.count()) {
        await numLink.click();
        await page.waitForURL(/\/cases\/[a-z0-9-]+$/i, { timeout: 12000 }).catch(() => {});
        await sleep(1000);
        // 步骤渲染表
        await h.spotlight('[data-testid="case-steps-view"]', 1600).catch(() => {});
        // 评论区：发表一条（幂等——已有演示评论则只展示）
        if ((await page.getByTestId("comment-content").count()) === 0) {
          if (await tap(page, "tab-comments")) {
            await sleep(500);
            await h.spotlight('[data-testid="comment-input"]', 900);
            await page
              .getByTestId("comment-input")
              .fill("演示-评审同事：建议补充 14:59 临界的边界用例");
            await page
              .getByTestId("comment-submit")
              .click()
              .catch(() => {});
            await page
              .getByTestId("comment-content")
              .first()
              .waitFor({ timeout: 8000 })
              .catch(() => {});
            await sleep(600);
          }
        } else if (await tap(page, "tab-comments")) {
          await sleep(900);
          await h.spotlight('[data-testid="comment-content"]', 1200).catch(() => {});
        }
        // 变更/历史面板
        if (await tap(page, "tab-changes")) {
          await sleep(600);
          await h.spotlight('[data-testid="change-timeline"]', 1500).catch(() => {});
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
      // 列表 ↔ 脑图切换（本集高光：先全景定格整树，再缩放到操作节点）
      await h.goto("/cases");
      await page.waitForLoadState("networkidle").catch(() => {});
      await h.narrate("S5");
      if (await tap(page, "view-mindmap")) {
        await page
          .waitForSelector('[data-testid="mindmap-canvas"]', { timeout: 15000 })
          .catch(() => {});
        await sleep(1500); // 全景定格
        await h.zoom('[data-testid="mindmap-canvas"]', 1.15, 700);
        // 键击编排：回车=兄弟用例、Tab=子级、F2/输入=改文本（useMindmapKeyboard 同口径）
        await page
          .getByTestId("mindmap-canvas")
          .click({ position: { x: 80, y: 80 } })
          .catch(() => {});
        await sleep(400);
        await page.keyboard.press("Enter"); // 添加兄弟
        await sleep(900); // 键入可见停顿
        await page.keyboard.type("演示-脑图新增用例", { delay: 60 });
        await sleep(600);
        await page.keyboard.press("Tab"); // 添加子级
        await sleep(900);
        await page.keyboard.type("演示-子步骤校验", { delay: 60 });
        await sleep(600);
        await h.spotlight('[data-testid="mindmap-save-btn"]', 1200).catch(() => {});
        // 不点保存：键击演示数据不入库，重录不堆积（CASE-007 保存链路已由 e2e 覆盖）
        await h.reset();
        await sleep(400);
        await tap(page, "view-list");
        await sleep(1200);
      }
      await fillDur(t0, 55);
    },
  },
  {
    seg: "S6",
    run: async (page, h) => {
      const t0 = Date.now();
      // 用例依赖：详情页添加「前置依赖」另一条演示用例（幂等：已有前置则仅展示）
      await h.goto("/cases");
      await page.waitForLoadState("networkidle").catch(() => {});
      await h.narrate("S6");
      if (await has(page, "input-keyword")) {
        await page.getByTestId("input-keyword").fill(CASE_NAME);
        await page.keyboard.press("Enter");
        await sleep(1200);
      }
      const row = page.getByRole("row", { name: new RegExp(CASE_NAME) });
      const numLink = row.getByRole("link", { name: /^C-\d{4,}$/ }).first();
      if (await numLink.count()) {
        await numLink.click();
        await page.waitForURL(/\/cases\/[a-z0-9-]+$/i, { timeout: 12000 }).catch(() => {});
        await sleep(800);
        if (await tap(page, "tab-dependencies")) {
          await sleep(600);
          const already = (await page.getByText(/前置依赖（本用例依赖的用例）（[1-9]/).count()) > 0;
          if (!already && (await tap(page, "btn-add-dependency"))) {
            await page.getByTestId("input-dep-search").fill(DEP_NAME);
            await sleep(700);
            await tap(page, "select-dep-target");
            const opt = page.getByRole("option", { name: new RegExp(DEP_NAME) }).first();
            if (await opt.count()) {
              await opt.click({ timeout: 6000 });
              const okBtn = page
                .getByRole("dialog")
                .getByRole("button", { name: /添\s*加/ })
                .first();
              if (await okBtn.count()) await okBtn.click();
              await page
                .getByText("已添加前置依赖")
                .waitFor({ timeout: 8000 })
                .catch(() => {});
            }
            await sleep(600);
          } else {
            // 已有前置依赖：表格特写（spotlight 仅支持 CSS 选择器）
            await h.spotlight("table", 1500).catch(() => {});
          }
          await h.spotlight('[data-testid="btn-add-dependency"]', 1000).catch(() => {});
        }
        // 「测试点」不在用例详情（挂在测试计划·测试规划 Tab）——以关联计划 Tab 带过（见文件头勘误）
        if (await tap(page, "tab-plans")) {
          await sleep(700);
          await h.spotlight('[data-testid="case-plan-table"]', 1300).catch(() => {});
        }
      }
      await h.reset();
      await fillDur(t0, 30);
    },
  },
  {
    seg: "S7",
    run: async (page, h) => {
      const t0 = Date.now();
      // 筛选：高级筛选面板（等级/标签/状态）→ 删除演示用例 → 回收站恢复
      await h.goto("/cases");
      await page.waitForLoadState("networkidle").catch(() => {});
      await h.narrate("S7");
      if (await tap(page, "btn-advanced-filter")) {
        await sleep(500);
        await h.spotlight('[data-testid="advanced-filter-panel"]', 1500).catch(() => {});
        await pickOption(page, "select-level", "P0");
        await sleep(900);
        // 复位等级筛选（allowClear 图标），避免与后续关键字搜索叠加把演示行滤没
        const level = page.getByTestId("select-level").first();
        if (await level.count()) {
          await level.hover().catch(() => {});
          const clear = level.locator(".ant-select-clear").first();
          if (await clear.count()) await clear.click();
          await sleep(600);
        }
        await tap(page, "btn-advanced-filter"); // 收起
        await sleep(500);
      }
      if (await has(page, "input-keyword")) {
        await page.getByTestId("input-keyword").fill(CASE_NAME);
        await page.keyboard.press("Enter");
        await sleep(1200);
      }
      const row = page.getByRole("row", { name: new RegExp(CASE_NAME) }).first();
      if (await row.count()) {
        const del = row.getByText("删除").first();
        if (await del.count()) {
          await del.click();
          await page
            .getByText("已删除")
            .first()
            .waitFor({ timeout: 8000 })
            .catch(() => {});
          await sleep(600);
        }
        // 回收站 → 恢复（btn-restore-{num}，按行号取第一个恢复按钮）
        if (await tap(page, "tab-recycle")) {
          await sleep(800);
          const restore = page.locator('[data-testid^="btn-restore-"]').first();
          if (await restore.count()) {
            await h.spotlight('[data-testid^="btn-restore-"]', 1000).catch(() => {});
            await restore.click();
            await page
              .getByText("已恢复")
              .first()
              .waitFor({ timeout: 8000 })
              .catch(() => {});
            await sleep(600);
          }
          await tap(page, "tab-all");
          await sleep(600);
        }
      }
      await h.reset();
      await fillDur(t0, 30);
    },
  },
];
