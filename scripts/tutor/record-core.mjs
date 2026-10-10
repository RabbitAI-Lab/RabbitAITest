#!/usr/bin/env node
/**
 * 教学视频录屏核心（README 四件套之三的共享库）：Screen Studio 式运镜注入 + 配音节拍同步。
 * 各集场景脚本（tests/demo/tutor-{ep}-*.mjs）export { scenes }，由 scripts/tutor/record.mjs 驱动：
 *   每镜一个独立 video context（storageState 复用登录态），录完落 portal/assets/tutor/rec/{ep}/{镜号}.webm。
 *
 * 运镜（注入 CSS/JS，零 AI 可复现）：
 *   cam.zoom(sel, scale)   —— body transform 平滑缩放（600ms），目标居中
 *   cam.reset()            —— 回全景
 *   cam.spotlight(sel, ms) —— 聚焦遮罩（box-shadow 9999px）
 *   光标高亮：常驻 follower 圆点 + 点击涟漪（addInitScript 注入）
 * 节拍：narrate(ep, seg) 用 ffprobe 读该镜配音时长并同步等待——保证录屏段 ≥ 配音，compose 免裁切。
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const WEB = process.env.TUTOR_WEB_URL ?? "http://localhost:3000";
export const MOCK = process.env.TUTOR_MOCK_URL ?? "http://127.0.0.1:4000";
export const TUTOR_DIR = path.join(ROOT, "portal/assets/tutor");
export const REC_DIR = path.join(TUTOR_DIR, "rec");
export const CARD_DIR = path.join(TUTOR_DIR, "cards");
export const VO_DIR = path.join(TUTOR_DIR, "vo");
const STATE_FILE = "/tmp/tutor-storage-state.json";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function voDuration(ep, seg) {
  const f = path.join(VO_DIR, ep, `${seg}.mp3`);
  if (!existsSync(f)) return 0;
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f],
    { encoding: "utf8" },
  ).trim();
  return Number.parseFloat(out);
}

/** 等待该镜配音播完（+padding），录屏段时长下限保障。 */
export async function narrate(ep, seg, pad = 400) {
  const d = voDuration(ep, seg);
  if (d > 0) await sleep((d + pad / 1000) * 1000);
  return d;
}

/** ── 光标高亮注入（每 context 自动挂） ── */
const CURSOR_JS = `
(() => {
  if (window.__tutor_cursor) return;
  window.__tutor_cursor = true;
  const dot = document.createElement("div");
  dot.style.cssText = "position:fixed;width:22px;height:22px;border-radius:50%;background:rgba(37,69,235,.35);border:2px solid #2545eb;z-index:99998;pointer-events:none;transform:translate(-50%,-50%);transition:left .12s ease-out,top .12s ease-out;left:-100px;top:-100px;";
  document.body.appendChild(dot);
  document.addEventListener("mousemove", (e) => {
    dot.style.left = e.clientX + "px"; dot.style.top = e.clientY + "px";
  }, { capture: true });
  document.addEventListener("mousedown", (e) => {
    const ripple = document.createElement("div");
    ripple.style.cssText = "position:fixed;width:14px;height:14px;border-radius:50%;border:3px solid #2545eb;z-index:99998;pointer-events:none;transform:translate(-50%,-50%) scale(1);opacity:.9;left:" + e.clientX + "px;top:" + e.clientY + "px;transition:transform .5s ease-out,opacity .5s;";
    document.body.appendChild(ripple);
    requestAnimationFrame(() => { ripple.style.transform = "translate(-50%,-50%) scale(4)"; ripple.style.opacity = "0"; });
    setTimeout(() => ripple.remove(), 550);
  }, { capture: true });
})();
`;

/** ── 运镜（页面内 JS） ── */
async function camZoom(page, selector, scale = 1.6, ms = 600) {
  await page.evaluate(
    ({ selector, scale, ms }) => {
      const el = selector ? document.querySelector(selector) : null;
      const origin = el
        ? (() => {
            const r = el.getBoundingClientRect();
            const x = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth);
            const y = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight);
            return `${x}px ${y}px`;
          })()
        : "50% 50%";
      const style = document.documentElement.style;
      style.setProperty("transition", `transform ${ms}ms cubic-bezier(.4,0,.2,1)`);
      style.setProperty("transform-origin", origin);
      style.setProperty("transform", `scale(${scale})`);
    },
    { selector, scale, ms },
  );
  await sleep(ms + 120);
}

async function camReset(page, ms = 500) {
  await page.evaluate((ms) => {
    const style = document.documentElement.style;
    style.setProperty("transition", `transform ${ms}ms cubic-bezier(.4,0,.2,1)`);
    style.setProperty("transform-origin", "50% 50%");
    style.setProperty("transform", "scale(1)");
  }, ms);
  await sleep(ms + 120);
}

async function spotlight(page, selector, ms = 1500) {
  await page.evaluate((selector) => {
    document.getElementById("__tutor_spot")?.remove();
    const el = document.querySelector(selector);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const hole = document.createElement("div");
    hole.id = "__tutor_spot";
    hole.style.cssText = `position:fixed;left:${r.left - 8}px;top:${r.top - 8}px;width:${r.width + 16}px;height:${r.height + 16}px;border-radius:10px;box-shadow:0 0 0 9999px rgba(15,23,42,.45),0 0 0 3px rgba(37,69,235,.9);z-index:99997;pointer-events:none;transition:all .4s;`;
    document.body.appendChild(hole);
  }, selector);
  await sleep(ms);
  await page.evaluate(() => document.getElementById("__tutor_spot")?.remove());
}

/** 平滑滚动到元素（运镜前的全景调整）。 */
async function panTo(page, selector) {
  await page.evaluate((selector) => {
    document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, selector);
  await sleep(700);
}

/** 展开左侧导航分组（性能/UI 测试等默认折叠；S11 e2e 同口径）。 */
async function expandGroup(page, label) {
  const collapsed = page.locator("div.nav-grp-collapsed", { hasText: label }).first();
  if (await collapsed.count()) {
    await page.getByText(label, { exact: true }).first().click();
    await sleep(450);
  }
}

/** 拟真输入（逐字符）与拟真点击（先移动再按）。 */
async function type(page, selector, text) {
  await page.click(selector, { timeout: 8000 });
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: 25 });
  }
}

export function helpers(page) {
  return {
    zoom: (sel, scale, ms) => camZoom(page, sel, scale, ms),
    reset: (ms) => camReset(page, ms),
    spotlight: (sel, ms) => spotlight(page, sel, ms),
    panTo: (sel) => panTo(page, sel),
    expandGroup: (label) => expandGroup(page, label),
    type: (sel, text) => type(page, sel, text),
    goto: (p) => page.goto(`${WEB}${p}`),
    narrate: undefined, // 由场景闭包注入（需 ep）
  };
}

/** API 登录并保存 storageState（录屏段免登录画面；1.2 自己表演注册登录）。 */
export async function loginAndSaveState(
  browser,
  { email = "admin@rabbit.test", password = "rabbit-admin-123" } = {},
) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const res = await ctx.request.post(`${WEB}/api/v1/auth/login`, {
    data: { email, password },
  });
  if (!res.ok()) throw new Error(`login ${res.status()}`);
  await page.goto(`${WEB}/`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await ctx.storageState({ path: STATE_FILE });
  await ctx.close();
  return STATE_FILE;
}

/**
 * 录一镜：fn(page, h) 内部自行动作；h.narrate(seg) 同步配音节拍。
 * 失败自动重试一次（dev 首编译超时自愈：首跑热路由，二跑成功）。返回落盘 webm 路径。
 */
export async function recordScene(browser, opts) {
  try {
    return await recordSceneOnce(browser, opts);
  } catch (e) {
    console.error(`  [scene-error] ${opts.ep}/${opts.seg}: ${e.message?.slice(0, 160)}`);
    console.log(`  [retry] ${opts.ep}/${opts.seg} 重试一次`);
    return await recordSceneOnce(browser, opts);
  }
}

async function recordSceneOnce(browser, { ep, seg, stateFile, headless = false, run }) {
  const dir = path.join(REC_DIR, ep);
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    recordVideo: { dir, size: { width: 1920, height: 1080 } },
    storageState: stateFile,
  });
  await ctx.addInitScript(CURSOR_JS);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const h = helpers(page);
  h.narrate = (segId, pad) => narrate(ep, segId ?? seg, pad);
  try {
    await run(page, h);
  } finally {
    const video = page.video();
    await ctx.close();
    const raw = await video.path();
    const out = path.join(dir, `${seg}.webm`);
    renameSync(raw, out);
    console.log(`  [rec] ${ep}/${seg} → ${path.relative(ROOT, out)}`);
    return out;
  }
}

/** 启动浏览器（有头，观感即录制所见）。 */
export async function launchBrowser() {
  return chromium.launch({ headless: process.env.TUTOR_HEADLESS === "1" });
}
