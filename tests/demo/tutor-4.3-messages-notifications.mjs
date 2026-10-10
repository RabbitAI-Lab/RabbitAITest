/**
 * 教学视频 4.3 消息与通知 场景模块（分镜表 S3~S6 录屏镜；片头/AI/字卡/片尾由 compose 管）。
 * 驱动：node scripts/tutor/record.mjs 4.3
 * 造数口径：站内信机器人=「演示-站内信」（channel=inapp，存在即复用）；
 *  S3 触发事件用其「测试发送」→ 站内信到达本人（MSG-001 ④ 同链路，无需第二账号）。
 *
 * 与分镜表的已知差异（报告不改 docs）：
 *  - S3：分镜为「双窗口分屏（左 member01 / 右 admin）」，record.mjs 每镜单页录制——
 *        改为单窗：铃铛视角下触发事件 → 未读徽标亮起（30s 轮询内）→ 打开面板看到新消息，全程无刷新。
 *  - S3：通知到达的实际机制是 30s 轮询（TopBar unreadCount refetchInterval），非 SSE 直推——等待窗按轮询周期放宽。
 *  - S4：「点击消息跳转来源（评审单）」在 UI 未实现（通知表无跳转链接）——以未读筛选/单条已读/全部已读呈现。
 */
import { sleep } from "../../scripts/tutor/record-core.mjs";

const ROBOT_NAME = "演示-站内信";

/** 末尾补足：录屏镜总时长 ≥ 分镜表时长。 */
async function pad(t0, sec) {
  const need = sec * 1000 - (Date.now() - t0);
  if (need > 0) await sleep(need);
}

/** 当前项目 id（/api/v1/personal/projects，data 为数组）。 */
async function firstPid(page) {
  try {
    const res = await page.request.get(new URL("/api/v1/personal/projects", page.url()).toString());
    const b = await res.json();
    return Array.isArray(b?.data) ? (b.data[0]?.id ?? null) : null;
  } catch {
    return null;
  }
}

/** 确保站内信演示机器人存在（存在即复用）并触发一次测试发送；失败 false。 */
async function fireRobotTest(page) {
  try {
    const pid = await firstPid(page);
    if (!pid) return false;
    let robotId = null;
    const list = await page.request.get(
      new URL(`/api/v1/projects/${pid}/robots`, page.url()).toString(),
    );
    if (list.ok()) {
      const b = await list.json();
      const arr = Array.isArray(b?.data) ? b.data : (b?.data?.items ?? []);
      const inapp =
        arr.find((r) => r?.name === ROBOT_NAME) ?? arr.find((r) => r?.channel === "inapp");
      robotId = inapp?.id ?? null;
    }
    if (!robotId) {
      const created = await page.request.post(
        new URL(`/api/v1/projects/${pid}/robots`, page.url()).toString(),
        { data: { name: ROBOT_NAME, channel: "inapp", enabled: true } },
      );
      if (!created.ok()) return false;
      robotId = (await created.json())?.data?.id ?? null;
    }
    if (!robotId) return false;
    const test = await page.request.post(
      new URL(`/api/v1/projects/${pid}/robots/${robotId}/test`, page.url()).toString(),
      { data: {} },
    );
    return test.ok();
  } catch {
    return false;
  }
}

export const scenes = [
  {
    seg: "S3", // 35s 实时推送：触发事件 → 未读徽标亮起 → 铃铛面板新增（无刷新）
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/");
      await sleep(1000);
      await h.narrate("S3");
      await h.spotlight('[data-testid="header-bell"]', 1200);
      const fired = await fireRobotTest(page);
      if (fired) {
        // 徽标 30s 轮询周期内亮起：提前出现即继续（最长 34s）
        const badge = page.locator(
          '[data-testid="header-bell"] .ant-badge-count, [data-testid="header-bell"] .ant-scroll-number',
        );
        for (let i = 0; i < 34; i++) {
          if (await badge.count()) break;
          await sleep(1000);
        }
        if (await badge.count()) {
          await h.spotlight('[data-testid="header-bell"]', 1500);
        }
        await page.getByTestId("header-bell").click();
        await sleep(1300);
        await h.spotlight('[data-testid="bell-dropdown"]', 1500).catch(() => {});
        await sleep(600);
        await page.keyboard.press("Escape");
        await sleep(400);
      } else {
        // 兜底：直接浏览铃铛面板既有通知（预置的执行任务通知）
        await page.getByTestId("header-bell").click();
        await sleep(1300);
        await h.spotlight('[data-testid="bell-dropdown"]', 1500).catch(() => {});
        await page.keyboard.press("Escape");
        await sleep(400);
      }
      await h.reset();
      await pad(t0, 35);
    },
  },
  {
    seg: "S4", // 25s /personal/notifications：未读筛选、单条已读、全部已读
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/personal/notifications");
      await sleep(1000);
      await h.narrate("S4");
      await page
        .getByTestId("page-personal-notifications")
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      // 未读/全部 二态切换（antd 两字按钮自动加空格渲染为「未 读」，用正则兼容）
      const unreadBtn = page.getByRole("button", { name: /未\s*读/ });
      if (await unreadBtn.count()) {
        await h.zoom('[data-testid="page-personal-notifications"]', 1.12, 500);
        await unreadBtn.click();
        await sleep(1100);
        await unreadBtn.click(); // 切回全部
        await sleep(900);
      }
      // 单条标记已读（存在未读行才有入口）
      const markOne = page.getByRole("button", { name: "标记已读" }).first();
      if (await markOne.count()) {
        await markOne.click().catch(() => {});
        await sleep(1100);
      }
      // 全部已读
      const all = page.getByTestId("btn-read-all");
      if (await all.count()) {
        await h.spotlight('[data-testid="btn-read-all"]', 900);
        await all.click().catch(() => {});
        await sleep(1300);
      }
      await h.reset();
      await pad(t0, 25);
    },
  },
  {
    seg: "S5", // 30s /settings/messages：事件订阅矩阵 + 模板变量编辑
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/settings/messages");
      await sleep(1000);
      await h.narrate("S5");
      await page
        .getByTestId("page-settings-messages")
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      // 事件配置 Tab：订阅矩阵
      const eventsTab = page.getByRole("tab", { name: "事件配置" });
      if (await eventsTab.count()) {
        await eventsTab.click();
        await sleep(900);
      }
      const panel = page.getByTestId("message-events-panel");
      if (await panel.count()) {
        await h.spotlight('[data-testid="message-events-panel"]', 1000);
        await h.panTo('[data-testid="event-row-BUG_CREATED"]').catch(() => {});
        await sleep(1300);
      }
      // 模板 Tab：模板编辑器 + 变量
      const tplTab = page.getByRole("tab", { name: "模板", exact: true });
      if (await tplTab.count()) {
        await tplTab.click();
        await sleep(900);
      }
      const ev = page.getByTestId("template-events");
      if (await ev.count()) {
        const first = ev.locator('[data-testid^="template-event-"]').first();
        if (await first.count()) {
          await first.click();
          await sleep(1000);
        }
        const editor = page.getByTestId("template-editor");
        if (await editor.count()) {
          await h.spotlight('[data-testid="template-editor"]', 1200);
          const chip = page.locator('[data-testid^="var-chip-"]').first();
          if (await chip.count()) {
            const tid = await chip.getAttribute("data-testid").catch(() => null);
            if (tid) await h.spotlight(`[data-testid="${tid}"]`, 900);
          }
        }
      }
      await h.reset();
      await pad(t0, 30);
    },
  },
  {
    seg: "S6", // 15s 机器人渠道：机器人 Tab 一览 + 新建入口（不保存）
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/settings/messages");
      await sleep(900);
      await h.narrate("S6");
      const botTab = page.getByRole("tab", { name: "机器人" });
      if (await botTab.count()) {
        await botTab.click();
        await sleep(900);
      }
      await h.zoom("main", 1.08, 500);
      await sleep(700);
      const btn = page.getByTestId("btn-new-robot");
      if (await btn.count()) {
        await h.spotlight('[data-testid="btn-new-robot"]', 900);
        await btn.click();
        await sleep(1000);
        await h.spotlight('[data-testid="robot-webhook-input"]', 1100).catch(() => {});
        await page.keyboard.press("Escape");
        await sleep(400);
        await page
          .getByRole("button", { name: /取\s*消/ })
          .first()
          .click()
          .catch(() => {});
        await sleep(400);
      }
      await h.reset();
      await pad(t0, 15);
    },
  },
];
