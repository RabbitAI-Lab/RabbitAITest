#!/usr/bin/env node
/**
 * 教学视频配音管线（README 四件套之二）：读 docs/tutorials 制作稿的「配音脚本」表，
 * 逐镜调 MiniMax T2A v2 合成 mp3，落盘 portal/assets/tutor/vo/{ep}/{镜号}.mp3。
 * 幂等：文件已存在且 >1KB 即跳过（--force 重生成）。额度感知：T2A 按量计费无日额，
 * 仅做 429 退避重试与 QPS 节流（串行 + 500ms 间隔）。
 *
 * 用法:
 *   node scripts/tutor/narrate.mjs <ep> [--force]   # 如 1.1
 *   node scripts/tutor/narrate.mjs all <n>          # 按总表顺序补 n 集（缺一镜即视为待做）
 *   node scripts/tutor/narrate.mjs status
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VO_DIR = path.join(ROOT, "portal/assets/tutor/vo");
const BASE = process.env.MINIMAX_BASE_URL ?? "https://api.minimax.cn";
const KEY = loadKey();

function loadKey() {
  if (process.env.MINIMAX_API_KEY) return process.env.MINIMAX_API_KEY;
  const envLocal = path.join(ROOT, ".env.local");
  if (existsSync(envLocal)) {
    const m = readFileSync(envLocal, "utf8").match(/^MINIMAX_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  console.error("[fatal] 缺 MINIMAX_API_KEY（环境变量或 .env.local）");
  process.exit(1);
}

// 剧集注册表（与 series-outline 总表一致）
const EPS = {
  1.1: "series-01-intro/1.1-course-intro.md",
  1.2: "series-01-intro/1.2-quick-start.md",
  2.1: "series-02-test-mgmt/2.1-concepts.md",
  2.2: "series-02-test-mgmt/2.2-functional-cases.md",
  2.3: "series-02-test-mgmt/2.3-case-review.md",
  2.4: "series-02-test-mgmt/2.4-bug-management.md",
  2.5: "series-02-test-mgmt/2.5-test-plans.md",
  3.1: "series-03-api-testing/3.1-concepts.md",
  3.2: "series-03-api-testing/3.2-api-debug.md",
  3.3: "series-03-api-testing/3.3-definitions-and-cases.md",
  3.4: "series-03-api-testing/3.4-scenarios.md",
  3.5: "series-03-api-testing/3.5-execution-and-pools.md",
  3.6: "series-03-api-testing/3.6-reports.md",
  4.1: "series-04-collab/4.1-org-projects-members.md",
  4.2: "series-04-collab/4.2-groups-permissions.md",
  4.3: "series-04-collab/4.3-messages-notifications.md",
  5.1: "series-05-ai/5.1-ai-assistant.md",
  5.2: "series-05-ai/5.2-ai-generate-cases.md",
  5.3: "series-05-ai/5.3-project-agents.md",
  6.1: "series-06-extension/6.1-plugins.md",
  6.2: "series-06-extension/6.2-open-integration.md",
  7.1: "series-07-ui-load/7.1-ui-testing.md",
  7.2: "series-07-ui-load/7.2-load-testing.md",
};

/** 解析制作稿「## 配音脚本」小节的 | 镜号 | 文案 | 行（跳过分隔行与表头）。 */
export function parseScript(ep) {
  const file = path.join(ROOT, "docs/tutorials", EPS[ep]);
  const md = readFileSync(file, "utf8");
  const sec = md.split(/^## /m).find((s) => s.startsWith("配音脚本"));
  if (!sec) throw new Error(`${EPS[ep]} 缺「## 配音脚本」小节`);
  const rows = [];
  for (const line of sec.split("\n")) {
    const m = line.match(/^\|\s*(S\d+)\s*\|\s*(.+?)\s*\|\s*$/);
    if (m && !/^[-\s|:]+$/.test(m[2])) rows.push({ seg: m[1], text: m[2] });
  }
  if (!rows.length) throw new Error(`${EPS[ep]} 配音脚本表为空`);
  return rows;
}

/** 英文术语前后插 200ms 停顿标签（Speech-02 <#ms#>；字幕仍用原文，不影响口径）。 */
function withPauses(text) {
  if (process.env.TUTOR_PLAIN === "1") return text;
  return text.replace(/([A-Za-z][A-Za-z0-9./+-]{1,}[A-Za-z0-9])/g, "<#200#>$1<#200#>");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function t2a(text) {
  const body = {
    model: process.env.TUTOR_T2A_MODEL ?? "speech-02-hd",
    text,
    stream: false,
    voice_setting: { voice_id: process.env.TUTOR_VOICE ?? "male-qn-qingse", speed: 0.9, vol: 1.0 },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
  };
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(`${BASE}/v1/t2a_v2`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    const rateHit = res.status === 429 || /rate limit/i.test(json?.base_resp?.status_msg ?? "");
    if (rateHit) {
      const wait = attempt * 4000;
      console.log(`  [ratelimit] 退避 ${wait}ms`);
      await sleep(wait);
      continue;
    }
    if (!res.ok || json?.base_resp?.status_code !== 0 || !json?.data?.audio) {
      throw new Error(`T2A ${res.status}: ${json?.base_resp?.status_msg ?? "no audio"}`);
    }
    return Buffer.from(json.data.audio, "hex");
  }
  throw new Error("T2A 连续限流");
}

function voFile(ep, seg) {
  return path.join(VO_DIR, ep, `${seg}.mp3`);
}

function isDone(ep, seg) {
  const f = voFile(ep, seg);
  return existsSync(f) && statSync(f).size > 1024;
}

async function narrateEp(ep, force) {
  const rows = parseScript(ep);
  const dir = path.join(VO_DIR, ep);
  mkdirSync(dir, { recursive: true });
  let ok = 0;
  for (const { seg, text } of rows) {
    if (!force && isDone(ep, seg)) {
      ok += 1;
      continue;
    }
    let buf;
    try {
      buf = await t2a(withPauses(text));
    } catch (e) {
      // 停顿标签兼容性兜底：原文重试一次
      console.log(`  [retry-plain] ${ep}/${seg}: ${e.message}`);
      buf = await t2a(text);
    }
    writeFileSync(voFile(ep, seg), buf);
    console.log(`[done] ${ep}/${seg} ${(buf.length / 1024).toFixed(0)}KB  ${text.slice(0, 24)}…`);
    ok += 1;
    await sleep(500);
  }
  console.log(`[narrate] ${ep} 完成 ${ok}/${rows.length}`);
  return ok === rows.length;
}

function printStatus() {
  let total = 0;
  let done = 0;
  for (const ep of Object.keys(EPS)) {
    const rows = parseScript(ep);
    const ok = rows.filter((r) => isDone(ep, r.seg)).length;
    total += rows.length;
    done += ok;
    console.log(`  ${ok === rows.length ? "✓" : "·"} ${ep.padEnd(4)} ${ok}/${rows.length}`);
  }
  console.log(`配音 ${done}/${total} 段（共 ${Object.keys(EPS).length} 集）`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "status") {
    printStatus();
  } else if (cmd === "all") {
    const limit = Number.parseInt(rest[0] ?? "99", 10);
    const eps = Object.keys(EPS).filter((ep) => parseScript(ep).some((r) => !isDone(ep, r.seg)));
    console.log(
      `[all] 待配音 ${eps.length} 集（限额 ${limit}）: ${eps.slice(0, limit).join(", ") || "无"}`,
    );
    for (const ep of eps.slice(0, limit)) await narrateEp(ep, false);
    printStatus();
  } else if (EPS[cmd]) {
    process.exit((await narrateEp(cmd, rest.includes("--force"))) ? 0 : 5);
  } else {
    console.error(`未知集号 '${cmd}'。可用: ${Object.keys(EPS).join(", ")} | all <n> | status`);
    process.exit(1);
  }
}
