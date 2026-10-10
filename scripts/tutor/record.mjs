#!/usr/bin/env node
/**
 * 教学视频录屏驱动（README 四件套之三）：加载 tests/demo/tutor-{ep}-{slug}.mjs 场景模块并逐镜录制。
 * 场景模块约定：export const scenes = [{ seg: "S3", run: async (page, h) => {} }, ...]
 *   h.goto(path)/h.zoom(sel,scale)/h.reset()/h.spotlight(sel,ms)/h.panTo(sel)/h.type(sel,text)/h.narrate(segId?)
 * 幂等：portal/assets/tutor/rec/{ep}/{镜号}.webm 已存在即跳过（--force 重录）。
 * 用法：node scripts/tutor/record.mjs <ep> [--force] [--only=S4,S5]
 */
import { existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EPS } from "./cards.mjs";
import { launchBrowser, loginAndSaveState, recordScene, REC_DIR } from "./record-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const ep = process.argv[2];
const force = process.argv.includes("--force");
const only = process.argv
  .find((a) => a.startsWith("--only="))
  ?.slice(7)
  ?.split(",");
if (!ep || !EPS[ep]) {
  console.error(
    `用法: record.mjs <ep> [--force] [--only=S4,S5]。可用: ${Object.keys(EPS).join(", ")}`,
  );
  process.exit(1);
}

const modFile = path.join(ROOT, "tests/demo", `tutor-${ep}-${EPS[ep][1]}.mjs`);
if (!existsSync(modFile)) {
  console.error(`场景模块不存在: tests/demo/tutor-${ep}-${EPS[ep][1]}.mjs`);
  process.exit(1);
}
const { scenes } = await import(`file://${modFile}`);
console.log(`[record] ${ep} 场景 ${scenes.length} 个（${scenes.map((s) => s.seg).join(", ")}）`);

const browser = await launchBrowser();
let adminState = null;
if (scenes.some((s) => !s.raw && !s.stateFile)) {
  adminState = await loginAndSaveState(browser);
  console.log(`[record] 管理员登录态已保存`);
}

let done = 0;
for (const scene of scenes) {
  const out = path.join(REC_DIR, ep, `${scene.seg}.webm`);
  if (!force && existsSync(out)) {
    console.log(`  [skip] ${scene.seg}（已存在）`);
    done += 1;
    continue;
  }
  if (only && !only.includes(scene.seg)) continue;
  await recordScene(browser, {
    ep,
    seg: scene.seg,
    stateFile: scene.stateFile ?? (scene.raw ? undefined : adminState),
    headless: scene.headless,
    run: scene.run,
  });
  done += 1;
}
await browser.close();
console.log(`[record] ${ep} 完成 ${done}/${scenes.length}`);
