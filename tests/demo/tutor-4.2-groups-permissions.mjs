/**
 * 教学视频 4.2 用户组与权限 场景模块（分镜表 S3~S7 录屏镜；片头/AI/字卡/片尾由 compose 管）。
 * 驱动：node scripts/tutor/record.mjs 4.2
 * 造数口径：演示组=「演示-只读成员」（项目级 /settings/groups，存在即复用）；
 *  二态账号=只读演示账号 demo-readonly@rabbit.test（需录制数据准备预置：注册 + 加入组织/项目 + 入「项目成员」组，
 *  仅保留只读权限集）；「工程师组」以项目预置组「项目管理员」等价承载（种子必有）。
 *
 * 与分镜表的已知差异（报告不改 docs）：
 *  - S5：分镜为「双 profile 分屏对比」，record.mjs 每镜单页录制——改为同机位先后呈现
 *        管理员态 →（会话切换）只读态，二态对比语义保留；只读账号缺失时降级为预置组只读提示演示。
 *  - S5 的 403 curl 演示（分镜标注「可选」）未实现：无入镜画面，UI 侧以按钮消失为准。
 */
import { sleep } from "../../scripts/tutor/record-core.mjs";

const DEMO_GROUP = "演示-只读成员";
const DEMO_RO_EMAIL = "demo-readonly@rabbit.test";
const DEMO_RO_PASS = "rabbit-demo-123";
const ADMIN = { email: "admin@rabbit.test", password: "rabbit-admin-123" };

/** 末尾补足：录屏镜总时长 ≥ 分镜表时长。 */
async function pad(t0, sec) {
  const need = sec * 1000 - (Date.now() - t0);
  if (need > 0) await sleep(need);
}

async function tidOf(locator) {
  try {
    return await locator.getAttribute("data-testid");
  } catch {
    return null;
  }
}

/** 会话切换（仅改本镜 context cookie；每镜独立 context，不影响其它镜）。成功 true。 */
async function loginAs(page, email, password) {
  try {
    const res = await page.request.post(new URL("/api/v1/auth/login", page.url()).toString(), {
      data: { email, password },
    });
    if (!res.ok()) return false;
    const ras = (res.headers()["set-cookie"] ?? "").split("ras=")[1]?.split(";")[0];
    if (!ras) return false;
    await page
      .context()
      .addCookies([{ name: "ras", value: ras, url: new URL("/", page.url()).toString() }]);
    return true;
  } catch {
    return false;
  }
}

export const scenes = [
  {
    seg: "S3", // 30s 系统级用户组一览 → 项目级：新建「演示-只读成员」组
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/system/groups");
      await sleep(1000);
      await h.narrate("S3");
      // 系统级预置组 + 只读提示（两级中的「系统级」）
      const preset = page.getByTestId("group-item-系统成员");
      if (await preset.count()) {
        await preset.click();
        await sleep(800);
        await page
          .getByText("预置组权限不可修改")
          .first()
          .waitFor({ timeout: 8000 })
          .catch(() => {});
        await h.spotlight(".ant-alert", 1000).catch(() => {});
      }
      await sleep(500);
      // 项目级用户组：新建演示组（存在即复用；组列表异步加载，先等任一组出现）
      await h.goto("/settings/groups");
      await sleep(1000);
      await page
        .locator('[data-testid^="group-item-"]')
        .first()
        .waitFor({ timeout: 8000 })
        .catch(() => {});
      await h.zoom("main", 1.08, 500);
      await sleep(500);
      if (!(await page.getByTestId(`group-item-${DEMO_GROUP}`).count())) {
        const btn = page.getByRole("button", { name: /新\s*建用户组/ });
        if (await btn.count()) {
          await btn.click();
          await sleep(700);
          await h.spotlight('[data-testid="input-new-group-name"]', 800);
          await page.getByTestId("input-new-group-name").fill(DEMO_GROUP);
          await sleep(500);
          await page
            .getByRole("dialog")
            .getByRole("button", { name: /创\s*建/ })
            .click()
            .catch(() => {});
          await sleep(1400);
        }
      }
      const g = page.getByTestId(`group-item-${DEMO_GROUP}`);
      if (await g.count()) {
        await h.spotlight(`[data-testid="group-item-${DEMO_GROUP}"]`, 1000);
        await g.click();
        await sleep(800);
      }
      await pad(t0, 30);
    },
  },
  {
    seg: "S4", // 25s 权限点矩阵：勾「用例查看」、不勾「用例删除」，保存
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/settings/groups");
      await sleep(900);
      await h.narrate("S4");
      await page
        .locator('[data-testid^="group-item-"]')
        .first()
        .waitFor({ timeout: 8000 })
        .catch(() => {});
      const g = page.getByTestId(`group-item-${DEMO_GROUP}`);
      await g.waitFor({ timeout: 6000 }).catch(() => {});
      if (await g.count()) await g.click();
      else {
        const any = page.locator('[data-testid^="group-item-"]').first();
        if (await any.count()) await any.click();
      }
      await sleep(900);
      const read = page.getByTestId("perm-check-PROJECT_CASE:READ");
      if (await read.count()) {
        await h.panTo('[data-testid="perm-check-PROJECT_CASE:READ"]').catch(() => {});
        await h.spotlight('[data-testid="perm-check-PROJECT_CASE:READ"]', 1200);
        const del = page.getByTestId("perm-check-PROJECT_CASE:DELETE");
        if (del && (await del.count()) && (await del.isChecked())) {
          await del.uncheck().catch(() => {}); // 明确不勾「用例删除」
          await sleep(500);
        }
        await read.check().catch(() => {});
        await sleep(600);
        const save = page.getByTestId("btn-save-group");
        if (await save.count()) {
          await h.spotlight('[data-testid="btn-save-group"]', 900);
          await save.click().catch(() => {});
          await page
            .getByText("权限已保存并即时生效")
            .first()
            .waitFor({ timeout: 8000 })
            .catch(() => {});
        }
      } else {
        // 矩阵缺位兜底：缓滚矩阵
        await h.panTo(".ant-table");
        await sleep(1500);
      }
      await h.reset();
      await pad(t0, 25);
    },
  },
  {
    seg: "S5", // 50s 二态对比：工程师可编辑删除 vs 只读无按钮（同机位先后呈现）
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/cases");
      await sleep(1000);
      await h.narrate("S5");
      // 账号 A（管理员/工程师视角）：新建/编辑可用
      await page
        .getByTestId("case-table")
        .waitFor({ timeout: 12000 })
        .catch(() => {});
      if (await page.getByTestId("btn-new-case").count()) {
        await h.spotlight('[data-testid="btn-new-case"]', 1200);
      }
      await h.zoom("main", 1.1, 500);
      await sleep(900);
      await h.reset();
      await sleep(400);
      // 账号 B（只读演示账号）：同一页面无新建按钮（READ 保留、CREATE 缺失）
      const ro = await loginAs(page, DEMO_RO_EMAIL, DEMO_RO_PASS);
      if (ro) {
        await h.goto("/cases");
        await sleep(1200);
        await page
          .getByTestId("case-table")
          .waitFor({ timeout: 12000 })
          .catch(() => {});
        await h.spotlight("main", 1200).catch(() => {}); // 同机位：表格仍在（可见）
        const gone = (await page.getByTestId("btn-new-case").count()) === 0;
        if (gone) await sleep(1200); // 口播点：删除/新建入口消失（前端按钮指令）
        await sleep(600);
        // 回管理员会话（本镜内恢复，避免影响后续镜）
        await loginAs(page, ADMIN.email, ADMIN.password);
        await sleep(500);
      } else {
        // 无预置只读账号：以预置组只读提示近似演示（SYS-004 口径）
        await h.goto("/settings/groups");
        await sleep(900);
        const p = page.getByTestId("group-item-项目成员");
        if (await p.count()) {
          await p.click();
          await sleep(900);
        }
        await h.panTo(".ant-table");
        await sleep(1600);
      }
      await h.reset();
      await pad(t0, 50);
    },
  },
  {
    seg: "S6", // 20s 把只读账号加入「项目管理员」组 → 刷新后按钮出现（即时生效）
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/settings/groups");
      await sleep(900);
      await h.narrate("S6");
      await page
        .locator('[data-testid^="group-item-"]')
        .first()
        .waitFor({ timeout: 8000 })
        .catch(() => {});
      const eng = page.getByTestId("group-item-项目管理员");
      const roOk = await loginAs(page, DEMO_RO_EMAIL, DEMO_RO_PASS); // 先验证只读账号在（只探测会话）
      await loginAs(page, ADMIN.email, ADMIN.password); // 立即回管理员做组操作
      if ((await eng.count()) && roOk) {
        await eng.click();
        await sleep(900);
        const sel = page.getByTestId("group-member-select");
        if (await sel.count()) {
          await sel.click();
          await sleep(500);
          await page.keyboard.type(DEMO_RO_EMAIL.split("@")[0], { delay: 40 });
          await sleep(1000);
          const opt = page.locator(`.ant-select-item-option[title*="${DEMO_RO_EMAIL}"]`).first();
          if (await opt.count()) {
            await opt.click();
            await sleep(500);
            const add = page.getByTestId("btn-group-add-member");
            if (await add.count()) {
              await h.spotlight('[data-testid="btn-group-add-member"]', 800);
              await add.click().catch(() => {}); // 已在组内时接口幂等/报错均可
              await sleep(1400);
            }
          } else {
            await page.keyboard.press("Escape");
          }
        }
        // 只读会话刷新：新建按钮回来了（权限即时生效）
        if (await loginAs(page, DEMO_RO_EMAIL, DEMO_RO_PASS)) {
          await h.goto("/cases");
          await sleep(1100);
          await page
            .getByTestId("case-table")
            .waitFor({ timeout: 12000 })
            .catch(() => {});
          if (await page.getByTestId("btn-new-case").count()) {
            await h.spotlight('[data-testid="btn-new-case"]', 1200);
          }
          await loginAs(page, ADMIN.email, ADMIN.password);
        }
      } else {
        // 兜底：演示成员添加控件（搜索不出候选即收起）
        const any = page.locator('[data-testid^="group-item-"]').first();
        if (await any.count()) {
          await any.click();
          await sleep(800);
        }
        const sel = page.getByTestId("group-member-select");
        if (await sel.count()) {
          await sel.click();
          await sleep(700);
          await page.keyboard.press("Escape");
        }
        await sleep(900);
      }
      await h.reset();
      await pad(t0, 20);
    },
  },
  {
    seg: "S7", // 15s /system/audit-logs：检索组变更记录
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/system/audit-logs");
      await sleep(1000);
      await h.narrate("S7");
      await page
        .getByTestId("page-system-audit-logs")
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      const kw = page.getByTestId("audit-keyword");
      if (await kw.count()) {
        await h.spotlight('[data-testid="audit-keyword"]', 800);
        await kw.fill("组");
        const go = page.getByTestId("audit-search-btn");
        if (await go.count()) await go.click();
        await sleep(1600);
      }
      await h.zoom("main table, main .ant-table", 1.12, 500).catch(() => {});
      await sleep(1200);
      await h.reset();
      await pad(t0, 15);
    },
  },
];
