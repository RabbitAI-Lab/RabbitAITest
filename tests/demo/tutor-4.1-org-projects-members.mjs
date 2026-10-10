/**
 * 教学视频 4.1 组织、项目与成员 场景模块（分镜表 S3~S7 录屏镜；S1 片头/S2 AI/S8 字卡/S9 片尾由 compose 管）。
 * 驱动：node scripts/tutor/record.mjs 4.1
 * 造数口径：演示数据一律「演示-」前缀、存在即复用（项目=演示-教程项目 / 部门=演示-质量部）。
 *
 * 与分镜表的已知差异（报告不改 docs）：
 *  - S3：admin 种子只有 1 个组织，而 org-switcher 需 >1 个组织才渲染（OrgSwitcher.tsx）——
 *        多组织环境走「切换器对比」，单组织兜底展示组织域上下文 + 项目列表。
 *  - S4：故事板「归档」在 UI 为行内「结束」（Popconfirm）——演示只 hover 不确认，保证可重复录制。
 *  - S5：部门页是「选节点 → 添加成员」表单形态，无树节点拖拽——按实际 UI 演示。
 *  - S6：组织成员页是「从系统用户中搜索添加」，无邮箱邀请+初始角色表单——按实际 UI 演示（候选下拉展示即收起，不重复添加）。
 */
import { sleep } from "../../scripts/tutor/record-core.mjs";

const DEMO_PROJECT = "演示-教程项目";
const DEMO_DEPT = "演示-质量部";

/** 末尾补足：录屏镜总时长 ≥ 分镜表时长（narrate 已在镜首等待配音时长）。 */
async function pad(t0, sec) {
  const need = sec * 1000 - (Date.now() - t0);
  if (need > 0) await sleep(need);
}

/** 动态 testid 定位（spotlight/zoom 走原生 CSS，先用 Playwright 定位取回 testid）。 */
async function tidOf(locator) {
  try {
    return await locator.getAttribute("data-testid");
  } catch {
    return null;
  }
}

export const scenes = [
  {
    seg: "S3", // 25s 顶栏组织切换器：组织 A/B 切换，列表整体变化
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/org/projects");
      await sleep(1000); // 进页全景 1s
      await h.narrate("S3");
      const sw = page.getByTestId("org-switcher");
      if (await sw.count()) {
        await h.spotlight('[data-testid="org-switcher"]', 1500);
        const curName = (await sw.textContent()) ?? "";
        await sw.click();
        await sleep(900);
        const items = page.locator(".ant-dropdown-menu-item");
        const cnt = await items.count();
        for (let i = 0; i < cnt; i++) {
          const label = ((await items.nth(i).textContent()) ?? "").trim();
          if (label && !label.includes("管理") && !curName.includes(label)) {
            await items.nth(i).click();
            break;
          }
        }
        await sleep(1800); // 项目列表随组织整体更换（RLS 隔离在 UI 层的呈现）
        await sleep(800);
      } else {
        // 单组织兜底：组织域上下文标识 + 项目管理列表
        await h.spotlight("header", 1200).catch(() => {});
        await page
          .getByText("组织级 · 跨项目")
          .first()
          .waitFor({ timeout: 8000 })
          .catch(() => {});
        await h.zoom("main", 1.1, 600);
        await sleep(1400);
      }
      await h.reset();
      await pad(t0, 25);
    },
  },
  {
    seg: "S4", // 30s /org/projects：新建项目 + 进入/归档入口
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/org/projects");
      await sleep(1000);
      await h.narrate("S4");
      const kw = page.getByTestId("input-project-keyword");
      let exists = false;
      if (await kw.count()) {
        // 列表首载竞态（org 上下文冷启动）：先等任一行出现，再搜索；搜索结果带一次重试
        await page
          .locator(".ant-table-row")
          .first()
          .waitFor({ timeout: 8000 })
          .catch(() => {});
        await kw.fill(DEMO_PROJECT);
        for (let i = 0; i < 3 && !exists; i++) {
          await sleep(900);
          exists =
            (await page
              .locator('[data-testid^="project-name-"]')
              .filter({ hasText: DEMO_PROJECT })
              .count()) > 0;
        }
        await kw.fill("");
        await sleep(600);
      }
      if (!exists) {
        const btn = page.getByTestId("btn-new-project");
        if (await btn.count()) {
          await h.spotlight('[data-testid="btn-new-project"]', 900);
          await btn.click();
          await sleep(700);
          await h.spotlight('[data-testid="input-new-project-name"]', 900);
          await h.type('[data-testid="input-new-project-name"]', DEMO_PROJECT);
          await sleep(400);
          await h.type('[data-testid="input-new-project-desc"]', "教学演示项目（可随时删除）");
          await page.keyboard.press("Enter");
          await sleep(1400);
          // Enter 未提交时点「确 定」兜底
          const ok = page.getByRole("dialog").getByRole("button", { name: /确\s*定/ });
          if (await ok.count()) await ok.click().catch(() => {});
          await sleep(1200);
        }
      }
      // 搜索收敛到演示项目行 → 行特写 + 结束(归档)/删除入口（hover 不确认，可重复录制）
      if (await kw.count()) {
        await kw.fill(DEMO_PROJECT);
        await sleep(900);
      }
      const nameEl = page
        .locator('[data-testid^="project-name-"]')
        .filter({ hasText: DEMO_PROJECT })
        .first();
      await nameEl.waitFor({ timeout: 8000 }).catch(() => {});
      if (await nameEl.count()) {
        const tid = await tidOf(nameEl);
        if (tid) await h.spotlight(`[data-testid="${tid}"]`, 1200);
        const row = page.locator("tr", { hasText: DEMO_PROJECT }).first();
        const closeBtn = row.getByText("结束", { exact: true }).first();
        if (await closeBtn.count()) await closeBtn.hover({ timeout: 6000 }).catch(() => {});
        await sleep(1000);
      }
      await h.reset();
      await pad(t0, 30);
    },
  },
  {
    seg: "S5", // 30s /org/departments：部门树 + 成员挂载（表单形态）
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/org/departments");
      await sleep(1000);
      await h.narrate("S5");
      await h.spotlight('[data-testid="department-tree"]', 1200).catch(() => {});
      const tree = page.getByTestId("department-tree");
      const nodeSel = '[data-testid^="department-node-"]';
      let nodeCount = (await tree.count()) ? await tree.locator(nodeSel).count() : 0;
      // 种子无部门：兜底建演示根部门（存在即复用）
      if (nodeCount === 0) {
        const btn = page.getByTestId("btn-new-department-root");
        if (await btn.count()) {
          await h.spotlight('[data-testid="btn-new-department-root"]', 800);
          await btn.click();
          await sleep(600);
          await h.spotlight('[data-testid="input-department-name"]', 800);
          await h.type('[data-testid="input-department-name"]', DEMO_DEPT);
          await sleep(400);
          const ok = page.getByRole("dialog").getByRole("button", { name: /创\s*建/ });
          if (await ok.count()) await ok.click().catch(() => {});
          await sleep(1400);
          nodeCount = (await tree.count()) ? await tree.locator(nodeSel).count() : 0;
        }
      }
      if (nodeCount > 0) {
        const first = tree.locator(nodeSel).first();
        const tid = await tidOf(first);
        if (tid) await h.spotlight(`[data-testid="${tid}"]`, 1000);
        await first.click();
        await sleep(900);
        await h.zoom('[data-testid="department-members"]', 1.15, 600).catch(() => {});
        await sleep(800);
        // 添加成员入口（打开即收起，不实际添加——幂等）
        const add = page.getByTestId("btn-add-department-member");
        if (await add.count()) {
          await h.spotlight('[data-testid="btn-add-department-member"]', 800);
          await add.click();
          await sleep(800);
          const sel = page.getByTestId("select-department-members");
          if (await sel.count()) {
            await sel.click();
            await sleep(700);
          }
          await page.keyboard.press("Escape");
          await sleep(400);
          await page
            .getByRole("button", { name: /取\s*消/ })
            .first()
            .click()
            .catch(() => {});
          await sleep(500);
        }
      }
      await h.reset();
      await pad(t0, 30);
    },
  },
  {
    seg: "S6", // 30s /org/members：添加成员（系统用户候选）+ 成员列表/角色
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/org/members");
      await sleep(1000);
      // 本页组织上下文取自当前项目（project store 冷启动竞态）：等列表就绪，最多 10s
      await page
        .getByTestId("input-org-member-keyword")
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      await sleep(600);
      await h.narrate("S6");
      await h.zoom("main table, main .ant-table", 1.12, 600).catch(() => {});
      await sleep(700);
      // 实际 UI 形态：从系统用户搜索添加（展示候选即收起，不重复添加）
      const sel = page.getByTestId("org-member-candidate-select");
      if (await sel.count()) {
        await h.spotlight('[data-testid="org-member-candidate-select"]', 900);
        await sel.click();
        await sleep(500);
        await page.keyboard.type("sys", { delay: 60 });
        await sleep(1100); // 候选项出现
        await h.spotlight(".ant-select-dropdown", 900).catch(() => {});
        await page.keyboard.press("Escape");
        await sleep(500);
      }
      // 成员搜索定位 + 行特写（角色列同屏）
      const kw = page.getByTestId("input-org-member-keyword");
      if (await kw.count()) {
        await kw.fill("admin");
        await sleep(900);
        const cell = page
          .locator('[data-testid^="org-member-"]')
          .filter({ hasText: "admin" })
          .first();
        if (await cell.count()) {
          const tid = await tidOf(cell);
          if (tid) await h.spotlight(`[data-testid="${tid}"]`, 1000);
        }
        await kw.fill("");
        await sleep(500);
      }
      await h.reset();
      await pad(t0, 30);
    },
  },
  {
    seg: "S7", // 20s /org/templates：组织级模板（字段/模板两个 Tab 缓滚）
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/org/templates");
      await sleep(1000);
      await h.narrate("S7");
      for (const tabTid of ["tab-fields", "tab-templates"]) {
        const tab = page.getByTestId(tabTid);
        if (await tab.count()) {
          await tab.click();
          await sleep(900);
        }
        await h.zoom("main table, main .ant-table", 1.12, 500).catch(() => {});
        await h.panTo("table tr:nth-child(2), .ant-table-row:nth-child(2)").catch(() => {});
        await sleep(900);
        await h.reset();
      }
      await pad(t0, 20);
    },
  },
];
