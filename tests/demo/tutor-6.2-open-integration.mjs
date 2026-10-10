/**
 * 教学视频 6.2 开放集成 场景模块（分镜表 S3/S4/S6/S7/S8/S9 录屏镜，S4 为 HTML 终端模拟；
 *  S1 片头/S2 AI/S5 字卡/S10 字卡/S11 片尾由 compose 管）。
 * 驱动：node scripts/tutor/record.mjs 6.2
 * 造数口径：演示 APIKEY=「演示-教程KEY」（/personal/api-keys，存在即复用——真实创建是本集演示内容）；
 *  终端 curl 的 ak/sk 一律演示假值，真实密钥不入镜。
 *
 * 与分镜表的已知差异（报告不改 docs）：
 *  - S3：创建表单实际只有「名称」输入，无 scope 勾选（INTG-003 同口径）——scope 概念由口播/字卡承担。
 *  - S4：终端为 HTML 终端模拟器（tutor-1.2 terminal() 同款），taskId/SUCCESS 为演示值，不真实发起执行。
 *  - S8：按录制约束「添加仓库 tab 打开即可，不真绑」——URL/平台/Token 表单特写后关抽屉；
 *        「已连接 · 默认分支 main」成功态以既有仓库卡片呈现（无可复用卡片时跳过该特写）。
 */
import { sleep } from "../../scripts/tutor/record-core.mjs";

const DEMO_KEY = "演示-教程KEY";
const SCM_DEMO_URL = "https://git.example.com/qa/scm-demo.git";

/** 末尾补足：录屏镜总时长 ≥ 分镜表时长。 */
async function pad(t0, sec) {
  const need = sec * 1000 - (Date.now() - t0);
  if (need > 0) await sleep(need);
}

/** HTML 终端模拟器：逐行打字 + 滚动日志（黑底浅字，等宽字体；tutor-1.2 同款）。 */
async function terminal(page, { title, command, lines, cps = 2 }) {
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>
      body { margin:0; background:#0d1117; height:1080px; width:1920px; overflow:hidden;
        font:26px/1.65 "SF Mono",Menlo,monospace; color:#c9d1d9; }
      .bar { background:#161b22; padding:14px 22px; color:#8b949e; font-size:22px; border-bottom:1px solid #30363d; }
      .win { padding:28px 40px; white-space:pre-wrap; }
      .cmd { color:#7ee787; font-weight:700; }
      .hl { color:#79c0ff; } .ok { color:#7ee787; } .dim { color:#8b949e; }
      .cur { display:inline-block; width:13px; height:26px; background:#c9d1d9; animation:blink 1s steps(1) infinite; vertical-align:middle; }
      @keyframes blink { 50% { opacity:0; } }
    </style></head><body><div class="bar">● ● ●　${title} — zsh — 160×40</div><div class="win" id="t"></div></body></html>`,
    { waitUntil: "domcontentloaded" },
  );
  await page.evaluate(
    ({ command, lines, cps }) => {
      const t = document.getElementById("t");
      const put = (html) => {
        t.insertAdjacentHTML("beforeend", html);
        window.scrollTo(0, 99999);
      };
      put(`<span class="cmd">$ ${command}</span><span class="cur" id="cur"></span>\n`);
      const queue = [];
      const step = () => {
        if (!queue.length) return;
        const { delay, html } = queue.shift();
        setTimeout(() => {
          document.getElementById("cur")?.remove();
          put(html + '<span class="cur" id="cur"></span>');
          step();
        }, delay);
      };
      for (const l of lines) queue.push({ delay: l.d ?? 320 / cps, html: l.c });
      step();
    },
    { command, lines, cps },
  );
}

export const scenes = [
  {
    seg: "S3", // 30s /personal/api-keys：创建演示 KEY（存在即复用）+ 一次性密钥特写
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/personal/api-keys");
      await sleep(1000);
      await h.narrate("S3");
      await page
        .getByTestId("page-personal-api-keys")
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      // 行/空态落定后再判断复用（APIKEY 名称不唯一，防加载竞态误建重复 KEY）
      await page
        .locator(".ant-table-row, .ant-empty")
        .first()
        .waitFor({ timeout: 8000 })
        .catch(() => {});
      const exists = (await page.locator(".ant-table-row", { hasText: DEMO_KEY }).count()) > 0;
      if (!exists) {
        const btn = page.getByTestId("apikey-create-btn");
        if (await btn.count()) {
          await h.spotlight('[data-testid="apikey-create-btn"]', 900);
          await btn.click();
          await sleep(800);
          await h.spotlight('[data-testid="apikey-name-input"]', 800);
          await h.type('[data-testid="apikey-name-input"]', DEMO_KEY);
          await sleep(500);
          await page
            .getByRole("button", { name: /创\s*建/ })
            .click()
            .catch(() => {});
          // 密钥只显示一次：ak/sk 一次性展示特写
          await page
            .getByTestId("apikey-ak")
            .waitFor({ timeout: 10000 })
            .catch(() => {});
          if (await page.getByTestId("apikey-ak").count()) {
            await h.spotlight('[data-testid="apikey-ak"]', 1100);
            await h.spotlight('[data-testid="apikey-sk"]', 1500);
            await sleep(700);
            await page
              .getByRole("button", { name: "我已保存，关闭" })
              .click()
              .catch(() => {});
            await sleep(900);
          }
        }
      } else {
        // 复用既有演示 KEY：列表行特写
        await h.zoom("main table, main .ant-table", 1.15, 600).catch(() => {});
        await sleep(1500);
      }
      await h.reset();
      await pad(t0, 30);
    },
  },
  {
    seg: "S4", // 45s 终端 curl：APIKEY 调开放 API 触发执行 → taskId → 轮询 SUCCESS（模拟）
    raw: true,
    run: async (page, h) => {
      await terminal(page, {
        title: "rabbitaitest — ci-demo",
        command:
          'curl -s -X POST localhost:3000/api/v1/open/exec/api-case \\\n  -u "rak-demo-key:sk-demo" -H "Content-Type: application/json" \\\n  -d \'{"apiCaseId":"c0ffee00-0000-4000-8000-000000000001","envId":"default"}\'',
        lines: [
          {
            c: '<span class="hl">{"code":0}</span> <span class="ok">"taskId":"f3a91c2e-7b44-4e21-9d0a-6c8f77b1e5d3"</span>',
          },
          { c: '<span class="dim"># 拿着 taskId 轮询（流水线里的 while 循环）</span>' },
          {
            c: '$ curl -s -u "rak-demo-key:sk-demo" localhost:3000/api/v1/open/exec/f3a91c2e…/status',
            d: 700,
          },
          { c: '<span class="hl">"PENDING"</span>' },
          {
            c: '$ curl -s -u "rak-demo-key:sk-demo" localhost:3000/api/v1/open/exec/f3a91c2e…/status',
            d: 900,
          },
          { c: '<span class="hl">"RUNNING"</span>' },
          {
            c: '$ curl -s -u "rak-demo-key:sk-demo" localhost:3000/api/v1/open/exec/f3a91c2e…/status',
            d: 1100,
          },
          {
            c: '<span class="ok">"SUCCESS"</span>　<span class="dim">exit 0 — 测试门禁通过，报告链接回填构建页</span>',
          },
        ],
      });
      await h.narrate("S4");
    },
  },
  {
    seg: "S6", // 25s /tasks：刚才触发的任务与报告入口（云端控制台与流水线同一份数据）
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/tasks");
      await sleep(1000);
      await h.narrate("S6");
      await page
        .getByTestId("task-center")
        .waitFor({ timeout: 12000 })
        .catch(() => {});
      await h.spotlight('[data-testid="task-list-table"]', 1200).catch(async () => {
        await h.spotlight("main table", 1200).catch(() => {});
      });
      // 最近任务的查看报告入口
      const report = page.locator('[data-testid^="btn-view-report-"]').first();
      if (await report.count()) {
        const tid = await report.getAttribute("data-testid").catch(() => null);
        if (tid) await h.spotlight(`[data-testid="${tid}"]`, 1000);
      }
      await h.zoom("main table, main .ant-table", 1.12, 600).catch(() => {});
      await sleep(1200);
      await h.reset();
      await pad(t0, 25);
    },
  },
  {
    seg: "S7", // 25s /settings/integrations 平台对接 + /settings/swagger-sync 定时同步（两页各约 12s）
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/settings/integrations");
      await sleep(1000);
      await h.narrate("S7");
      await page
        .getByTestId("page-settings-integrations")
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      const cards = page.locator('[data-testid^="integration-card-"]');
      const n = await cards.count();
      if (n > 0) {
        for (let i = 0; i < Math.min(n, 3); i++) {
          const tid = await cards
            .nth(i)
            .getAttribute("data-testid")
            .catch(() => null);
          if (tid) {
            await h.spotlight(`[data-testid="${tid}"]`, i === 0 ? 1200 : 700);
          }
        }
      } else {
        await h.spotlight("main", 1200).catch(() => {});
      }
      await sleep(700);
      await h.reset();
      await h.goto("/settings/swagger-sync");
      await sleep(1100);
      await page
        .getByTestId("page-settings-swagger-sync")
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      const rows = page.locator('[data-testid^="swagger-run-"]');
      if (await rows.count()) {
        const tid = await rows
          .first()
          .getAttribute("data-testid")
          .catch(() => null);
        if (tid) await h.spotlight(`[data-testid="${tid}"]`, 1200);
        await h.zoom("main table, main .ant-table", 1.1, 500).catch(() => {});
      } else {
        await h.spotlight('[data-testid="swagger-create-btn"]', 1000).catch(() => {});
        await h.spotlight("main table, main .ant-table", 1200).catch(() => {});
      }
      await sleep(900);
      await h.reset();
      await pad(t0, 25);
    },
  },
  {
    seg: "S8", // 35s /settings/code-repos 添加仓库（tab 打开即可，不真绑）→ /system/scm-apps 一览（约 8s 带过）
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/settings/code-repos");
      await sleep(1000);
      await h.narrate("S8");
      await page
        .getByTestId("page-settings-code-repos")
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      const add = page.getByTestId("btn-add-repo");
      if (await add.count()) {
        await h.spotlight('[data-testid="btn-add-repo"]', 900);
        await add.click();
        await page
          .getByTestId("drawer-add-repo")
          .waitFor({ timeout: 10000 })
          .catch(() => {});
        await sleep(900);
        // 「仓库地址」tab：URL + 平台 + Token（填演示值，不真实绑定）
        const url = page.getByTestId("input-repo-url");
        if (await url.count()) {
          await h.spotlight('[data-testid="input-repo-url"]', 900);
          await h.type('[data-testid="input-repo-url"]', SCM_DEMO_URL);
          await sleep(500);
        }
        const prov = page.getByTestId("select-scm-provider");
        if (await prov.count()) await h.spotlight('[data-testid="select-scm-provider"]', 800);
        const token = page.getByTestId("input-scm-token");
        if (await token.count()) await h.spotlight('[data-testid="input-scm-token"]', 800);
        await sleep(700);
        await page.keyboard.press("Escape"); // 关抽屉（不绑定）
        await sleep(700);
      }
      // 既有仓库卡片的「已连接 · 默认分支 main」成功态（无可复用卡片即跳过）
      const card = page.locator('[data-testid^="repo-card-"]').first();
      if (await card.count()) {
        const tid = await card.getAttribute("data-testid").catch(() => null);
        if (tid) await h.spotlight(`[data-testid="${tid}"]`, 1200);
      }
      // 系统级代码平台（OAuth 应用）一览
      await h.goto("/system/scm-apps");
      await sleep(1100);
      await page
        .getByTestId("page-system-scm-apps")
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      const appCard = page.locator('[data-testid^="scm-app-card-"]').first();
      if (await appCard.count()) {
        const tid = await appCard.getAttribute("data-testid").catch(() => null);
        if (tid) await h.spotlight(`[data-testid="${tid}"]`, 1200);
      }
      await h.zoom("main", 1.1, 500);
      await sleep(1400);
      await h.reset();
      await pad(t0, 35);
    },
  },
  {
    seg: "S9", // 15s /system/params：全局参数维护（表格缓滚）
    run: async (page, h) => {
      const t0 = Date.now();
      await h.goto("/system/params");
      await sleep(1000);
      await h.narrate("S9");
      const site = page.getByTestId("input-site-url");
      if (await site.count()) await h.spotlight('[data-testid="input-site-url"]', 1200);
      await h.panTo('[data-testid="input-smtp-host"], input').catch(() => {});
      await sleep(900);
      await h.zoom("main", 1.1, 500);
      await sleep(1300);
      await h.reset();
      await pad(t0, 15);
    },
  },
];
