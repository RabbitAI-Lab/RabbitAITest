/**
 * 教学视频 1.2 五分钟上手 场景模块（S3~S6、S8 录屏镜；S3/S8 为 HTML 终端模拟）。
 * 驱动：node scripts/tutor/record.mjs 1.2
 * S4 注册固定账号 demo@rabbit.test（重复录制需先清库，见录制要点）。
 */
import { sleep } from "../../scripts/tutor/record-core.mjs";

const DEMO_EMAIL = "demo@rabbit.test";
const DEMO_PASS = "rabbit-demo-123";
const STATE = "/tmp/tutor-state-1.2.json";

/** HTML 终端模拟器：逐行打字 + 滚动日志（黑底浅字，等宽字体）。 */
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
      let queue = [];
      const put = (html) => {
        t.insertAdjacentHTML("beforeend", html);
        window.scrollTo(0, 99999);
      };
      put(`<span class="cmd">$ ${command}</span><span class="cur" id="cur"></span>\n`);
      const step = () => {
        if (!queue.length) return;
        const { delay, html } = queue.shift();
        setTimeout(() => {
          document.getElementById("cur")?.remove();
          put(
            html +
              (queue.length
                ? '<span class="cur" id="cur"></span>'
                : '<span class="cur" id="cur"></span>'),
          );
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
    seg: "S3",
    raw: true,
    run: async (page, h) => {
      await terminal(page, {
        title: "rabbitaitest — pnpm dev",
        command: "pnpm dev",
        lines: [
          {
            c: '<span class="dim">rabbitaitest@dev · worktree slot=0（web :3000 · mock :4000 · pg :5440）</span>',
          },
          { c: '<span class="hl">[pg]</span> embedded-postgres 初始化 .pgdata … 完成（5440）' },
          {
            c: '<span class="hl">[pg]</span> prisma migrate deploy … 51 migrations <span class="ok">applied</span>',
          },
          {
            c: '<span class="hl">[pg]</span> seed … 管理员/组织/项目/资源池 <span class="ok">ok</span>',
          },
          { c: '<span class="hl">[redis]</span> 6379 · db0 <span class="ok">PONG</span>' },
          { c: '<span class="hl">[engine]</span> worker 启动 · 注册资源池 runner-1' },
          {
            c: '<span class="hl">[mock]</span> Hono mock 应用监听 <span class="ok">http://127.0.0.1:4000</span>',
          },
          {
            c: '<span class="hl">[web]</span> <span class="ok">✓ Ready in 3.2s</span> → http://localhost:3000',
          },
          { c: '<span class="dim">按 CTRL+C 停止</span>' },
        ],
      });
      await h.narrate("S3");
    },
  },
  {
    seg: "S4",
    raw: true,
    run: async (page, h) => {
      await h.goto("/register");
      await sleep(600);
      await h.spotlight('[data-testid="register-page"] form, [data-testid="register-page"]', 800);
      await h.type('[data-testid="register-email"]', DEMO_EMAIL);
      await sleep(300);
      await h.type('[data-testid="register-password"]', DEMO_PASS);
      await sleep(300);
      await h.type('[data-testid="register-confirm"]', DEMO_PASS);
      await h.narrate("S4", 600);
      await page.getByTestId("register-submit").click();
      await page.waitForURL("**/", { timeout: 15000 }).catch(() => {});
      await sleep(1500);
    },
    // 注册后把新账号态存给 S5/S6 —— 通过 run 里访问 ctx 不方便，改在 S5 开头用 API 登录兜底
  },
  {
    seg: "S5",
    run: async (page, h) => {
      // 兜底登录（S4 若已注册过会直接跳工作台；这里保证态正确——record-core 会带 admin 态，这里重登 demo）
      await page.request
        .post("http://localhost:3000/api/v1/auth/login", {
          data: { email: DEMO_EMAIL, password: DEMO_PASS },
        })
        .catch(() => {});
      await h.goto("/org/projects");
      await sleep(1000);
      await h.narrate("S5");
      await page.getByTestId("btn-new-project").click();
      await sleep(700);
      await h.spotlight('[data-testid="input-new-project-name"]', 900);
      await h.type('[data-testid="input-new-project-name"]', "demo-project");
      await sleep(500);
      await page.keyboard.press("Enter");
      await sleep(1200);
    },
  },
  {
    seg: "S6",
    run: async (page, h) => {
      await h.goto("/");
      await sleep(900);
      await h.narrate("S6");
      await h.zoom('aside,nav,[class*="sidebar"]', 1.25, 700);
      await sleep(800);
      await h.reset();
      await page
        .getByTestId("user-avatar")
        .click()
        .catch(() => {});
      await sleep(1200);
      await page.keyboard.press("Escape");
      await sleep(400);
    },
  },
  {
    seg: "S8",
    raw: true,
    run: async (page, h) => {
      await terminal(page, {
        title: "rabbitaitest — pnpm test",
        command: "pnpm test",
        lines: [
          { c: '<span class="dim">turbo run test · 8 packages</span>' },
          { c: 'packages/shared: <span class="ok">✓</span> 124 tests' },
          { c: 'packages/db:      <span class="ok">✓</span> 86 tests' },
          { c: 'apps/engine:     <span class="ok">✓</span> 217 tests' },
          { c: 'apps/web:        <span class="ok">✓</span> 431 tests' },
          { c: '<span class="ok"> Tests  858 passed (858)</span>' },
          { c: '<span class="ok"> Duration  96.4s</span>' },
        ],
      });
      await h.narrate("S8");
    },
  },
];
