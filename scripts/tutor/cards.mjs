#!/usr/bin/env node
/**
 * 教学视频字卡渲染（README：字卡用 HTML 渲染导出 PNG，不用 AI）。
 * 从制作稿「分镜表」解析 类型=字卡 的镜，按文案启发式套模板，Playwright 截图 1920×1080。
 * 另渲染品牌兔耳徽标 logo.png（透明底，供片头尾部叠加——outline §3.3 勘误 1）。
 *
 * 用法：node scripts/tutor/cards.mjs <ep> [--force] | all | logo
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CARD_DIR = path.join(ROOT, "portal/assets/tutor/cards");

/** 剧集 → [制作稿相对路径, slug] 注册表（record/compose 共用）。 */
export const EPS = {
  1.1: ["series-01-intro/1.1-course-intro.md", "course-intro"],
  1.2: ["series-01-intro/1.2-quick-start.md", "quick-start"],
  2.1: ["series-02-test-mgmt/2.1-concepts.md", "concepts"],
  2.2: ["series-02-test-mgmt/2.2-functional-cases.md", "functional-cases"],
  2.3: ["series-02-test-mgmt/2.3-case-review.md", "case-review"],
  2.4: ["series-02-test-mgmt/2.4-bug-management.md", "bug-management"],
  2.5: ["series-02-test-mgmt/2.5-test-plans.md", "test-plans"],
  3.1: ["series-03-api-testing/3.1-concepts.md", "concepts"],
  3.2: ["series-03-api-testing/3.2-api-debug.md", "api-debug"],
  3.3: ["series-03-api-testing/3.3-definitions-and-cases.md", "definitions-and-cases"],
  3.4: ["series-03-api-testing/3.4-scenarios.md", "scenarios"],
  3.5: ["series-03-api-testing/3.5-execution-and-pools.md", "execution-and-pools"],
  3.6: ["series-03-api-testing/3.6-reports.md", "reports"],
  4.1: ["series-04-collab/4.1-org-projects-members.md", "org-projects-members"],
  4.2: ["series-04-collab/4.2-groups-permissions.md", "groups-permissions"],
  4.3: ["series-04-collab/4.3-messages-notifications.md", "messages-notifications"],
  5.1: ["series-05-ai/5.1-ai-assistant.md", "ai-assistant"],
  5.2: ["series-05-ai/5.2-ai-generate-cases.md", "ai-generate-cases"],
  5.3: ["series-05-ai/5.3-project-agents.md", "project-agents"],
  6.1: ["series-06-extension/6.1-plugins.md", "plugins"],
  6.2: ["series-06-extension/6.2-open-integration.md", "open-integration"],
  7.1: ["series-07-ui-load/7.1-ui-testing.md", "ui-testing"],
  7.2: ["series-07-ui-load/7.2-load-testing.md", "load-testing"],
};

/** 解析分镜表行（镜号/类型/时长/画面与动作）。 */
export function parseStoryboard(ep) {
  const md = readFileSync(path.join(ROOT, "docs/tutorials", EPS[ep][0]), "utf8");
  const sec = md.split(/^## /m).find((s) => s.startsWith("分镜表"));
  if (!sec) throw new Error(`${EPS[ep][0]} 缺分镜表`);
  const rows = [];
  for (const line of sec.split("\n")) {
    const m = line.match(
      /^\|\s*(S\d+)\s*\|\s*(片头|AI|录屏|字卡|转场|片尾)\s*\|\s*([\d]+)s?\s*\|\s*(.+?)\s*\|/,
    );
    if (m) rows.push({ seg: m[1], type: m[2], dur: Number(m[3]), action: m[4] });
  }
  return rows;
}

const STYLE = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1920px; height:1080px; overflow:hidden; font-family:"PingFang SC","Hiragino Sans GB","Songti SC",system-ui,sans-serif;
    background:radial-gradient(1200px 800px at 70% -10%, #1a2b6b 0%, #0b1530 55%, #070d22 100%); color:#fff; position:relative; }
  .deco { position:absolute; border-radius:50%; border:1px solid rgba(80,120,255,.18); }
  .brand { position:absolute; top:64px; left:96px; display:flex; align-items:center; gap:18px; opacity:.9; }
  .brand svg { width:54px; height:54px; }
  .brand span { font-size:26px; letter-spacing:2px; color:#9db2ff; font-weight:600; }
  .center { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; }
  h1 { font-size:74px; font-weight:700; letter-spacing:3px; line-height:1.3; text-shadow:0 4px 30px rgba(37,69,235,.5); }
  h1 small { display:block; font-size:34px; color:#8fa5f5; font-weight:400; margin-top:22px; letter-spacing:6px; }
  ul { list-style:none; margin-top:30px; }
  ul li { font-size:44px; line-height:2.0; color:#dbe4ff; letter-spacing:1px; }
  ul li::before { content:""; display:inline-block; width:16px; height:16px; border-radius:4px; background:#2545eb; margin-right:26px; transform:rotate(45deg); box-shadow:0 0 18px rgba(37,69,235,.9); }
  .cols { display:grid; grid-template-columns:1fr 1fr; gap:8px 80px; margin-top:34px; text-align:left; }
  .cols .series { font-size:30px; color:#7f96ff; font-weight:700; margin-top:16px; letter-spacing:1px; }
  .cols .ep { font-size:25px; color:#c9d5ff; line-height:1.9; font-weight:400; }
  .links { margin-top:60px; font-size:28px; color:#8fa5f5; letter-spacing:1px; }
  .pipeline { display:flex; align-items:center; gap:26px; margin-top:40px; }
  .pipeline .node { padding:20px 34px; border:2px solid rgba(37,69,235,.8); border-radius:14px; font-size:32px; color:#dbe4ff; background:rgba(37,69,235,.12); }
  .pipeline .arrow { font-size:36px; color:#5f7cff; }
  code { display:block; margin-top:36px; font-family:"SF Mono",Menlo,monospace; font-size:24px; color:#9db2ff; background:rgba(10,18,44,.8); border:1px solid rgba(80,120,255,.25); border-radius:10px; padding:18px 28px; text-align:left; }
`;

const LOGO_SVG = `<svg viewBox="0 0 64 64" fill="none"><path d="M20 30 C16 14 22 4 28 6 C33 8 32 20 30 30" fill="#2545eb"/><path d="M40 29 C46 14 54 8 58 12 C61 16 54 26 46 32" fill="#2545eb"/><circle cx="34" cy="42" r="15" fill="#fff"/><circle cx="28" cy="40" r="2.4" fill="#0b1530"/><circle cx="40" cy="40" r="2.4" fill="#0b1530"/></svg>`;

function brandBar() {
  return `<div class="brand">${LOGO_SVG}<span>RabbitAITest 功能教学</span></div>
  <div class="deco" style="width:900px;height:900px;right:-320px;bottom:-380px;"></div>
  <div class="deco" style="width:520px;height:520px;right:-120px;bottom:-180px;"></div>`;
}

const TOC = [
  ["系列一 · 课程简介", "1.1 课程简介 / 1.2 五分钟上手"],
  ["系列二 · 测试管理", "2.1 概念 / 2.2 功能用例 / 2.3 评审 / 2.4 缺陷 / 2.5 测试计划"],
  [
    "系列三 · 接口测试",
    "3.1 概念 / 3.2 调试 / 3.3 定义与用例 / 3.4 场景 / 3.5 任务与资源池 / 3.6 报告",
  ],
  ["系列四 · 团队协作", "4.1 组织项目成员 / 4.2 用户组权限 / 4.3 消息通知"],
  ["系列五 · AI 能力", "5.1 AI 助手 / 5.2 AI 生成用例 / 5.3 项目 Agent"],
  ["系列六 · 扩展与集成", "6.1 插件体系 / 6.2 开放集成"],
  ["系列七 · UI 与性能测试", "7.1 UI 测试 / 7.2 性能测试"],
];

/** 字卡文案 → HTML（启发式分型）。 */
export function cardHtml(ep, action) {
  const seriesName = {
    1: "课程简介",
    2: "测试管理",
    3: "接口测试",
    4: "团队协作",
    5: "AI 能力",
    6: "扩展与集成",
    7: "UI 与性能测试",
  }[Number(ep.split(".")[0])];
  if (action.includes("系列目录树")) {
    return `${brandBar()}<div class="center"><h1 style="font-size:56px;">课程目录<small>7 系列 · 23 集 · 约 95 分钟</small></h1>
      <div class="cols">${TOC.map(([s, e]) => `<div><div class="series">${s}</div><div class="ep">${e}</div></div>`).join("")}</div></div>`;
  }
  if (action.includes("收官页")) {
    return `${brandBar()}<div class="center"><h1>感谢观看<small>让测试工作更简单</small></h1>
      <div class="links">GitHub · RabbitAI-Lab/RabbitAITest　｜　文档站 · docs.rabbitai.dev</div></div>`;
  }
  if (action.includes("CI/CD")) {
    return `${brandBar()}<div class="center"><h1 style="font-size:58px;">CI/CD 集成模式</h1>
      <div class="pipeline"><div class="node">流水线</div><span class="arrow">→</span><div class="node">APIKEY 触发</div><span class="arrow">→</span><div class="node">轮询 / 回调</div><span class="arrow">→</span><div class="node">报告链接回填</div></div>
      <code>curl -X POST -H "Authorization: Bearer $RABBIT_KEY" \\<br>&nbsp;&nbsp;/api/v1/projects/$PID/scenarios/execute …</code></div>`;
  }
  const preview = action.match(/「(.+?)」/)?.[1];
  if (action.includes("感谢观看")) {
    return `${brandBar()}<div class="center"><h1>感谢观看<small>让测试工作更简单</small></h1></div>`;
  }
  if (preview) {
    return `${brandBar()}<div class="center"><h1 style="font-size:64px;">${preview}</h1><ul><li>下节预告</li></ul></div>`;
  }
  if (action.includes("要点：")) {
    const items = action
      .replace(/^.*?要点：/, "")
      .split(/[·｜]|&&/)
      .map((s) => s.trim())
      .filter(Boolean);
    return `${brandBar()}<div class="center"><h1 style="font-size:56px;">本集要点</h1><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul></div>`;
  }
  // 通用标题卡（含「」引用的课程标题）
  const title = action.match(/「(.+?)」/)?.[1] ?? action;
  return `${brandBar()}<div class="center"><h1>${title}<small>系列${seriesName ? " · " + seriesName : ""}</small></h1></div>`;
}

async function shoot(browser, html, out) {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${html}</body></html>`,
    { waitUntil: "networkidle" },
  );
  await page.screenshot({ path: out });
  await page.close();
  console.log(`  [card] ${path.relative(ROOT, out)}`);
}

export async function renderEpCards(ep, force) {
  mkdirSync(CARD_DIR, { recursive: true });
  const rows = parseStoryboard(ep).filter((r) => r.type === "字卡" || r.type === "片尾");
  const browser = await chromium.launch({ headless: true });
  try {
    for (const r of rows) {
      const out = path.join(CARD_DIR, `${ep}-${r.seg}.png`);
      if (!force && existsSync(out)) continue;
      await shoot(browser, cardHtml(ep, r.action), out);
    }
  } finally {
    await browser.close();
  }
}

async function renderLogo() {
  mkdirSync(CARD_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 480, height: 480 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${LOGO_SVG.replace("<svg ", '<svg style="width:480px;height:480px" ')}</body></html>`,
  );
  await page.screenshot({ path: path.join(CARD_DIR, "logo.png"), omitBackground: true });
  await browser.close();
  console.log("[card] logo.png");
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "logo") {
    await renderLogo();
  } else if (cmd === "all") {
    for (const ep of Object.keys(EPS)) await renderEpCards(ep, rest.includes("--force"));
  } else if (EPS[cmd]) {
    await renderEpCards(cmd, rest.includes("--force"));
  } else {
    console.error(`用法: cards.mjs <ep> [--force] | all | logo`);
    process.exit(1);
  }
}
