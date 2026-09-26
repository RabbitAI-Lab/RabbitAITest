#!/usr/bin/env node
/**
 * 视觉还原度比对（rules/testing.md §3.7）：
 *   高保真原型（docs/design 下 HTML，先经 Playwright 渲染为 PNG）
 *   ↔ 实现截图（tests/visual/snapshots/*.png，由 VISUAL-snapshots.spec.ts 产出）
 *   → GLM-5.3-Flash 多模态对比 → 还原度评分与差异清单（tests/visual/report.md）
 *
 * 用法：node scripts/visual-diff.mjs [--enforce]   （--enforce：低于阈值时退出码 1）
 * 环境：GLM_API_KEY / ZHIPUAI_API_KEY 必填；GLM_BASE_URL 默认智谱开放平台；
 *       GLM_VISION_MODEL 默认 glm-5.3-flash；GLM_VISUAL_THRESHOLD 默认 80。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ENFORCE = process.argv.includes("--enforce");
const API_KEY = process.env.GLM_API_KEY ?? process.env.ZHIPUAI_API_KEY ?? "";
const BASE_URL = process.env.GLM_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4";
const MODEL = process.env.GLM_VISION_MODEL ?? "glm-5.3-flash";
const THRESHOLD = Number(process.env.GLM_VISUAL_THRESHOLD ?? 80);

const manifest = [
  {
    name: "登录页",
    prototype: "docs/design/SYS-001-registration-login/index.html",
    shot: "tests/visual/snapshots/login.png",
  },
  {
    name: "顶栏与工作台（项目切换）",
    prototype: "docs/design/SYS-003-org-project-init/index.html",
    shot: "tests/visual/snapshots/dashboard.png",
  },
  {
    name: "用例列表",
    prototype: "docs/design/CASE-001-case-crud/list.html",
    shot: "tests/visual/snapshots/case-list.png",
  },
  {
    name: "新建用例表单",
    prototype: "docs/design/CASE-001-case-crud/form.html",
    shot: "tests/visual/snapshots/case-form.png",
  },
  {
    name: "调试台",
    prototype: "docs/design/API-001-http-debug/index.html",
    shot: "tests/visual/snapshots/debug.png",
  },
  {
    name: "执行报告",
    prototype: "docs/design/RPT-001-execution-report-mvp/index.html",
    shot: "tests/visual/snapshots/report.png",
  },
];

const PROMPT = `你是资深 UI 走查评审。第一张图是高保真原型（设计基线），第二张图是当前实现截图。
请评估实现对原型的还原度，只输出一个 JSON 对象（不要 markdown 代码块）：
{"similarity": <0-100 整数，整体还原度>, "verdict": "pass" | "warn" | "fail",
 "layout": <0-100 布局结构还原>, "color": <0-100 颜色/品牌还原>, "detail": <0-100 组件细节还原>,
 "differences": ["具体差异，每条一句话，按影响排序"], "suggestions": ["改进建议，最多 3 条"]}
判定标准：similarity≥80 pass；60-79 warn（可接受但有明显偏差）；<60 fail。截图中的示例数据内容差异不算扣分项，只评估视觉/布局/样式。`;

function b64(file) {
  return readFileSync(file).toString("base64");
}

/** 原型 HTML → PNG（1280×800，等待 Tailwind CDN 渲染）。 */
async function renderPrototypes(items) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  mkdirSync(path.join(ROOT, "tests/visual/prototypes"), { recursive: true });
  for (const it of items) {
    const out = path.join(ROOT, "tests/visual/prototypes", path.basename(it.shot));
    await page
      .goto("file://" + path.join(ROOT, it.prototype), { waitUntil: "networkidle", timeout: 30000 })
      .catch(() => undefined);
    await page.waitForTimeout(600);
    await page.screenshot({ path: out });
    it.protoPng = out;
  }
  await browser.close();
}

async function compare(it) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: `data:image/png;base64,${b64(it.protoPng)}` } },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${b64(path.join(ROOT, it.shot))}` },
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`GLM API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  /** @type {{choices?: {message?: {content?: string}}[]}} */
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  const jsonText = content.replace(/```json|```/g, "").trim();
  const m = jsonText.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : jsonText);
}

async function main() {
  const missing = manifest.filter((it) => !existsSync(path.join(ROOT, it.shot)));
  if (missing.length > 0) {
    console.error(
      "缺少实现截图，先运行：pnpm test:visual\n  " + missing.map((m) => m.shot).join("\n  "),
    );
    process.exit(2);
  }
  if (!API_KEY) {
    console.warn("未设置 GLM_API_KEY/ZHIPUAI_API_KEY：跳过多模态比对（仅完成原型渲染）。");
    console.warn("启用方法：export GLM_API_KEY=... && node scripts/visual-diff.mjs");
    await renderPrototypes(manifest);
    process.exit(0);
  }

  console.log(`[visual-diff] 模型=${MODEL} 阈值=${THRESHOLD} 样本=${manifest.length}`);
  await renderPrototypes(manifest);

  const results = [];
  for (const it of manifest) {
    process.stdout.write(`  ${it.name} … `);
    try {
      const r = await compare(it);
      results.push({ ...it, ok: true, ...r });
      console.log(`${r.similarity}（${r.verdict}）`);
    } catch (e) {
      results.push({ ...it, ok: false, error: e instanceof Error ? e.message : String(e) });
      console.log(`比对失败：${results.at(-1)?.error}`);
    }
  }

  const lines = [
    "# 视觉还原度报告（高保真 ↔ 实现）",
    "",
    `- 模型：${MODEL} ｜ 阈值：${THRESHOLD} ｜ 时间：${new Date().toISOString()}`,
    "",
    "| 页面 | 还原度 | 判定 | 布局 | 颜色 | 细节 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...results.map(
      (r) =>
        `| ${r.name} | ${r.ok ? r.similarity : "—"} | ${r.ok ? r.verdict : "ERROR"} | ${r.ok ? r.layout : "—"} | ${r.ok ? r.color : "—"} | ${r.ok ? r.detail : "—"} |`,
    ),
    "",
    ...results.flatMap((r) => [
      `## ${r.name}`,
      r.ok ? "" : `> 比对失败：${r.error}`,
      ...(r.differences ?? []).map((d) => `- 差异：${d}`),
      ...(r.suggestions ?? []).map((s) => `- 建议：${s}`),
      "",
    ]),
  ];
  mkdirSync(path.join(ROOT, "tests/visual"), { recursive: true });
  writeFileSync(path.join(ROOT, "tests/visual/report.md"), lines.join("\n"));
  console.log(`\n报告：tests/visual/report.md`);

  if (ENFORCE) {
    const bad = results.filter((r) => !r.ok || r.similarity < THRESHOLD);
    if (bad.length > 0) {
      console.error(
        `visual-diff: ${bad.length} 项低于阈值 ${THRESHOLD}（${bad.map((b) => b.name).join("、")}）`,
      );
      process.exit(1);
    }
  }
  console.log("visual-diff: done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
