#!/usr/bin/env node
/**
 * 教学视频总控（README 四件套的批处理入口）：单集全管线 = narrate → cards → record → compose。
 * 幂等：每环已有产物即跳过（--force 全部重来）。
 * 用法：
 *   node scripts/tutor/make.mjs 1.1          # 单集全管线
 *   node scripts/tutor/make.mjs 1.1 --from=record   # 跳过配音/字卡
 *   node scripts/tutor/make.mjs all [n]      # 按序做 n 集（缺成片即做）
 *   node scripts/tutor/make.mjs status       # 全系列产线状态总览
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EPS, parseStoryboard } from "./cards.mjs";
import { parseScript } from "./narrate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TUTOR = path.join(ROOT, "portal/assets/tutor");
const run = (file, args) => {
  console.log(`\n━━ ${path.basename(file)} ${args.join(" ")}`);
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/tutor", file), ...args], {
    stdio: "inherit",
    env: { ...process.env, TUTOR_HEADLESS: process.env.TUTOR_HEADLESS ?? "1" },
  });
  if (r.status !== 0) throw new Error(`${file} ${args.join(" ")} 退出码 ${r.status}`);
};
const probeDur = (f) => {
  try {
    return Number.parseFloat(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim(),
    );
  } catch {
    return 0;
  }
};

function epStatus(ep) {
  const final = path.join(TUTOR, `${ep}-${EPS[ep][1]}.mp4`);
  const voSegs = parseScript(ep).length;
  const voDone = parseScript(ep).filter((r) =>
    existsSync(path.join(TUTOR, "vo", ep, `${r.seg}.mp3`)),
  ).length;
  const cards = parseStoryboard(ep).filter((r) => r.type === "字卡" || r.type === "片尾").length;
  const cardsDone = parseStoryboard(ep)
    .filter((r) => r.type === "字卡" || r.type === "片尾")
    .filter((r) => existsSync(path.join(TUTOR, "cards", `${ep}-${r.seg}.png`))).length;
  const recSegs = parseStoryboard(ep).filter((r) => r.type === "录屏").length;
  const recDone = parseStoryboard(ep)
    .filter((r) => r.type === "录屏")
    .filter((r) => existsSync(path.join(TUTOR, "rec", ep, `${r.seg}.webm`))).length;
  const broll = existsSync(path.join(TUTOR, "broll", `broll-${ep}.mp4`));
  const sceneMod = existsSync(path.join(ROOT, "tests/demo", `tutor-${ep}-${EPS[ep][1]}.mjs`));
  const dur = probeDur(final);
  return {
    final: existsSync(final),
    dur,
    voDone,
    voSegs,
    cardsDone,
    cards,
    recDone,
    recSegs,
    broll,
    sceneMod,
  };
}

function printStatus() {
  const head = ["集", "场景", "broll", "配音", "字卡", "录屏", "成片", "时长"].join(" | ");
  console.log(head);
  for (const ep of Object.keys(EPS)) {
    const s = epStatus(ep);
    console.log(
      [
        ep.padEnd(4),
        s.sceneMod ? "✓" : "✗",
        s.broll ? "✓" : "✗",
        `${s.voDone}/${s.voSegs}`,
        `${s.cardsDone}/${s.cards}`,
        `${s.recDone}/${s.recSegs}`,
        s.final ? "✓" : "✗",
        s.dur
          ? `${Math.floor(s.dur / 60)}:${String(Math.round(s.dur % 60)).padStart(2, "0")}`
          : "-",
      ].join(" | "),
    );
  }
}

async function makeEp(ep, opts) {
  const from = opts.from ?? "narrate";
  if (from === "narrate") run("narrate.mjs", [ep]);
  if (from === "narrate" || from === "cards") run("cards.mjs", [ep]);
  run("record.mjs", [ep]);
  run("compose.mjs", [ep]);
  const s = epStatus(ep);
  console.log(
    `\n[make] ${ep} → ${s.final ? `成片 ${Math.floor(s.dur / 60)}:${String(Math.round(s.dur % 60)).padStart(2, "0")}` : "失败"}`,
  );
}

const [cmd, ...rest] = process.argv.slice(2);
const force = process.argv.includes("--force");
const from = process.argv.find((a) => a.startsWith("--from="))?.slice(7);
if (cmd === "status") {
  printStatus();
} else if (cmd === "all") {
  const n = Number.parseInt(rest[0] ?? "99", 10);
  const todo = Object.keys(EPS).filter(
    (ep) => !existsSync(path.join(TUTOR, `${ep}-${EPS[ep][1]}.mp4`)),
  );
  console.log(`[all] 待制作 ${todo.length} 集（本轮 ${Math.min(n, todo.length)}）`);
  for (const ep of todo.slice(0, n)) await makeEp(ep, { from });
  printStatus();
} else if (EPS[cmd]) {
  await makeEp(cmd, { from, force });
} else {
  console.error("用法: make.mjs <ep> | all [n] | status [--from=narrate|cards|record]");
  process.exit(1);
}
