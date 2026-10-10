#!/usr/bin/env node
/**
 * 教学视频合成（README 四件套之四）：ffmpeg 按分镜时序拼 片头/AI/录屏/字卡，混配音轨，烧字幕。
 * 时序事实源 = 制作稿分镜表（镜号/类型/时长）+ 实际录屏长度 + 配音长度：
 *   AI 段超配音时长 → 整段慢放对齐；录屏短于配音 → 尾帧定格补齐；字卡时长 = max(分镜, 配音+0.8s)。
 * 字幕 = 配音脚本原文逐镜烧录（白字靛蓝描边底部居中，ASS）。
 * 片头勘误 1：broll-intro 裁至 4.5s + 兔耳徽标 PNG 淡入 0.9s（outline §3.3）。
 * 产物：portal/assets/tutor/{ep}-{slug}.mp4（1920×1080/30fps/H264+AAC）。
 * 用法：node scripts/tutor/compose.mjs <ep> [--force]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EPS, parseStoryboard } from "./cards.mjs";
import { parseScript } from "./narrate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TUTOR = path.join(ROOT, "portal/assets/tutor");
const TMP = path.join(TUTOR, ".compose-tmp");

const ff = (args) =>
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
const probeDur = (f) =>
  Number.parseFloat(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f],
      {
        encoding: "utf8",
      },
    ).trim(),
  );
const hasAudio = (f) =>
  execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "csv=p=0",
      f,
    ],
    { encoding: "utf8" },
  ).trim().length > 0;

/** 分段计划：{ kind, seg, src, dur, raw?, voSeg?, voDur? } */
function planSegments(ep) {
  const rows = parseStoryboard(ep);
  const vo = Object.fromEntries(parseScript(ep).map((r) => [r.seg, r]));
  const plan = [];
  for (const r of rows) {
    const voSeg = vo[r.seg] ?? null;
    const voDur = voSeg ? probeDur(path.join(TUTOR, "vo", ep, `${r.seg}.mp3`)) : 0;
    if (r.type === "片头") {
      plan.push({
        kind: "intro",
        seg: r.seg,
        src: path.join(TUTOR, "broll/broll-intro.mp4"),
        dur: 5.4,
        voSeg,
        voDur,
      });
    } else if (r.type === "AI") {
      const src = path.join(TUTOR, `broll/broll-${ep}.mp4`);
      plan.push({
        kind: "broll",
        seg: r.seg,
        src,
        dur: Math.max(probeDur(src), voDur + 0.8),
        raw: probeDur(src),
        voSeg,
        voDur,
      });
    } else if (r.type === "录屏") {
      const src = path.join(TUTOR, "rec", ep, `${r.seg}.webm`);
      if (!existsSync(src))
        throw new Error(`缺录屏 ${path.relative(ROOT, src)}——先跑 record.mjs ${ep}`);
      const raw = probeDur(src);
      plan.push({
        kind: "rec",
        seg: r.seg,
        src,
        dur: Math.max(raw, voDur + 0.5),
        raw,
        voSeg,
        voDur,
      });
    } else if (r.type === "字卡" || r.type === "片尾" || r.type === "转场") {
      const src = path.join(TUTOR, "cards", `${ep}-${r.seg}.png`);
      if (!existsSync(src))
        throw new Error(`缺字卡 ${path.relative(ROOT, src)}——先跑 cards.mjs ${ep}`);
      plan.push({ kind: "card", seg: r.seg, src, dur: Math.max(r.dur, voDur + 0.8), voSeg, voDur });
    }
  }
  return plan;
}

/** ASS 字幕（白字靛蓝描边底部居中；文案=配音脚本原文）。 */
function buildAss(plan, font) {
  const esc = (s) => s.replace(/[{}]/g, "").replace(/,/g, "，");
  const ts = (t) => {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = (t % 60).toFixed(2).padStart(5, "0");
    return `${h}:${String(m).padStart(2, "0")}:${s}`;
  };
  let t = 0;
  const events = [];
  for (const p of plan) {
    if (p.voDur > 0 && p.voSeg) {
      const start = t + 0.35;
      const end = Math.min(t + p.dur - 0.1, start + p.voDur - 0.15);
      if (end > start)
        events.push(`Dialogue: 0,${ts(start)},${ts(end)},Main,,0,0,0,,${esc(p.voSeg.text)}`);
    }
    t += p.dur;
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,${font},58,&H00FFFFFF,&H00FFFFFF,&HC0EB4525,&H90000000,0,0,0,0,100,100,0,0,1,2.6,1.2,2,90,90,44,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
}

async function main() {
  const ep = process.argv[2];
  const force = process.argv.includes("--force");
  if (!ep || !EPS[ep]) {
    console.error(`用法: compose.mjs <ep> [--force]。可用: ${Object.keys(EPS).join(", ")}`);
    process.exit(1);
  }
  const outFile = path.join(TUTOR, `${ep}-${EPS[ep][1]}.mp4`);
  if (existsSync(outFile) && !force) {
    console.log(`[skip] ${path.relative(ROOT, outFile)} 已存在`);
    return;
  }
  mkdirSync(TMP, { recursive: true });
  const plan = planSegments(ep);
  console.log(
    `[compose] ${ep} 分段 ${plan.length} 个，总长 ${plan.reduce((a, p) => a + p.dur, 0).toFixed(1)}s`,
  );

  const parts = [];
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    const out = path.join(TMP, `seg${String(i).padStart(2, "0")}.mp4`);
    if (existsSync(out) && !force && Math.abs(probeDur(out) - p.dur) < 0.4) {
      parts.push(out);
      console.log(`  [seg] ${p.seg} ${p.kind} ${p.dur.toFixed(1)}s（缓存）`);
      continue;
    }

    // 输入装填：视频(0) [+logo(1)] + VO mp3 + 字幕 PNG（intro 的 logo 占 1 号位）
    const args = ["-hide_banner", "-loglevel", "error", "-y"];
    let baseChain = ""; // 主视频处理链（0:v → [vb]）
    let audioIdx = -1;
    let subIdx = -1;

    if (p.kind === "card") {
      args.push("-loop", "1", "-t", p.dur.toFixed(2), "-i", p.src);
      baseChain = `scale=1920:1080,fps=30,setsar=1,format=yuv420p,fade=t=in:st=0:d=0.2,fade=t=out:st=${(p.dur - 0.2).toFixed(2)}:d=0.2`;
    } else if (p.kind === "intro") {
      args.push("-t", "4.5", "-i", p.src);
      baseChain = `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,setsar=1,format=yuv420p,fade=t=out:st=4.37:d=0.13`;
    } else if (p.kind === "broll") {
      const slow = p.dur / p.raw;
      args.push("-i", p.src);
      baseChain = `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,setsar=1,setpts=${slow.toFixed(4)}*PTS,format=yuv420p`;
    } else {
      const pad = Math.max(0, p.dur - p.raw);
      args.push("-i", p.src);
      baseChain = `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,setsar=1,tpad=stop_mode=clone:stop_duration=${pad.toFixed(2)},format=yuv420p`;
    }

    if (p.voDur > 0 && p.voSeg) {
      args.push("-i", path.join(TUTOR, "vo", ep, `${p.seg}.mp3`));
      audioIdx = args.filter((a, idx) => args[idx - 1] === "-i").length - 1;
      const subPng = await renderSubPng(p, path.join(TMP, `${ep}-sub-${p.seg}.png`));
      if (subPng) {
        args.push("-loop", "1", "-t", p.dur.toFixed(2), "-i", subPng);
        subIdx = args.filter((a, idx) => args[idx - 1] === "-i").length - 1;
      }
    }

    // 滤镜图：主链 + intro logo + 可选字幕 overlay（每段最多一条 → 无死锁）
    const chains = [];
    if (p.kind === "intro") {
      const logo = path.join(TUTOR, "cards", "logo.png");
      args.push("-loop", "1", "-t", "0.95", "-i", logo);
      const logoIdx = args.filter((a, idx) => args[idx - 1] === "-i").length - 1;
      chains.push(`[0:v]${baseChain}[vb]`);
      chains.push(`[${logoIdx}:v]scale=420:420,format=rgba,fade=t=in:st=0.15:d=0.3:alpha=1[lg]`);
      chains.push("[vb][lg]overlay=(W-w)/2:(H-h)/2-30,format=yuv420p[vc]");
    } else {
      chains.push(`[0:v]${baseChain}[vc]`);
    }
    if (subIdx >= 0) {
      const end = Math.min(p.dur - 0.1, 0.35 + p.voDur + 0.25);
      chains.push(
        `[vc][${subIdx}:v]overlay=(W-w)/2:H-h-64:enable='between(t,0.35,${end.toFixed(2)})'[v]`,
      );
    } else {
      chains.push("[vc]null[v]");
    }

    const maps = ["-map", "[v]", ...(audioIdx >= 0 ? ["-map", `${audioIdx}:a`] : [])];
    ff([
      ...args,
      "-filter_complex",
      chains.join(";"),
      ...maps,
      "-t",
      p.dur.toFixed(2),
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "19",
      "-pix_fmt",
      "yuv420p",
      ...(audioIdx >= 0
        ? [
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-af",
            "aresample=48000,pan=stereo|c0=c0|c1=c0,adelay=350|350,apad",
          ]
        : ["-an"]),
      out,
    ]);

    if (audioIdx < 0 || !hasAudio(out)) {
      const tmp = `${out}.muted.mp4`;
      ff([
        "-i",
        out,
        "-f",
        "lavfi",
        "-t",
        probeDur(out).toFixed(2),
        "-i",
        "anullsrc=r=48000:cl=stereo",
        "-map",
        "0:v",
        "-map",
        "1:a",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "48000",
        "-ac",
        "2",
        tmp,
      ]);
      execFileSync("mv", [tmp, out]);
    }
    parts.push(out);
    console.log(
      `  [seg] ${p.seg} ${p.kind} ${p.dur.toFixed(1)}s${p.voDur ? ` vo=${p.voDur.toFixed(1)}s` : ""}${subIdx >= 0 ? " 字幕✓" : ""}`,
    );
  }

  const listFile = path.join(TMP, "list.txt");
  writeFileSync(listFile, parts.map((p) => `file '${p}'`).join("\n"));
  const joined = path.join(TMP, "joined.mp4");
  ff(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", joined]);
  ff(["-i", joined, "-c", "copy", outFile]);
  if (renderSubPng.browser) await renderSubPng.browser.close().catch(() => {});

  console.log(
    `[compose] 完成 → ${path.relative(ROOT, outFile)}（${probeDur(outFile).toFixed(1)}s）`,
  );
}

/** 字幕条渲染（HTML→PNG 透明底，白字靛蓝描边）。 */
async function renderSubPng(p, file) {
  const { chromium } = await import("@playwright/test");
  renderSubPng.browser ??= await chromium.launch({ headless: true });
  renderSubPng.page ??= await renderSubPng.browser.newPage({
    viewport: { width: 1760, height: 400 },
  });
  const page = renderSubPng.page;
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>
      body { margin:0; background:transparent; display:flex; align-items:flex-end; justify-content:center; height:400px; }
      .sub { font-family:"PingFang SC","Hiragino Sans GB",system-ui,sans-serif; font-size:46px; font-weight:600;
        color:#fff; line-height:1.55; text-align:center; max-width:1700px; letter-spacing:1px;
        text-shadow:3px 0 0 #2545eb,-3px 0 0 #2545eb,0 3px 0 #2545eb,0 -3px 0 #2545eb,2px 2px 0 #2545eb,-2px 2px 0 #2545eb,2px -2px 0 #2545eb,-2px -2px 0 #2545eb,0 5px 18px rgba(7,13,34,.8); }
    </style></head><body><div class="sub">${p.voSeg.text.replace(/[<>]/g, "")}</div></body></html>`,
    { waitUntil: "domcontentloaded" },
  );
  await page.locator(".sub").screenshot({ path: file });
  return file;
}

await main();
