/**
 * 教学视频 5.3 项目 Agent 场景模块（分镜表 S3~S9 六个录屏镜）。
 * 驱动：node scripts/tutor/record.mjs 5.3
 * 造数前置：node scripts/tutor/prep.mjs；模型网关可用（同 5.1 口径）。
 *
 * 演示数据约定：「演示-」前缀 + 存在即复用——
 *   演示-用例设计助手（chat·module.tree 工具）/ 演示-生成管线（pipeline）/ 技能 my-skill（模板 zip 上传）。
 * 已知 UI 差异（见录制报告，不改 docs）：
 *   - 分镜 S5 的「生成密钥/轮换/吊销」按钮在当前 UI 未接线（rotateKeyMut/revokeKeyMut 无触发点，
 *     一次性弹窗 agent-key-plaintext 无法从 UI 打开）——本模块走 API 生成密钥后 spotlight 卡片密钥前缀。
 *   - S4 新建 Agent 的「选角色」在 UI 是角色分类 Select（默认 CUSTOM），无独立角色输入步骤。
 */
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { sleep, WEB } from "../../scripts/tutor/record-core.mjs";

const CHAT_AGENT = "演示-用例设计助手";
const PIPE_AGENT = "演示-生成管线";
const TPL_SKILL = "my-skill"; // 技能模板 zip 内 SKILL.md 的 name（AGENT-005 模板即 my-skill/）
const ZIP_PATH = "/tmp/skill-template.zip";

/** 跨镜状态（Agent id / 生成 runId / 草稿路径；重录单镜时各镜开头会现查兜底）。 */
const S = { chatId: null, pipeId: null, runId: null, draftsPath: null };

// ───────────────────────── 小助手（与 s2-helpers.pickOption 同法） ─────────────────────────

async function pickOption(page, trigger, optionText) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await trigger.click({ timeout: 5000 });
      const dropdown = page
        .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
        .filter({ visible: true })
        .last();
      await dropdown.waitFor({ state: "visible", timeout: 2500 });
      const opt = dropdown
        .getByText(optionText, typeof optionText === "string" ? { exact: true } : undefined)
        .first();
      await opt.click({ timeout: 3000 });
      return true;
    } catch (e) {
      lastErr = e;
    }
  }
  console.warn(`[tutor-5.3] pickOption 未选中「${String(optionText)}」：${lastErr?.message ?? ""}`);
  return false;
}

/** API 信封解包（失败返回 null，不抛——录屏健壮性优先）。 */
async function api(page, method, path, data) {
  try {
    const res =
      method === "GET"
        ? await page.request.get(`${WEB}${path}`)
        : await page.request.post(`${WEB}${path}`, { data });
    const body = await res.json().catch(() => null);
    return body?.code === 0 ? body.data : null;
  } catch {
    return null;
  }
}

let _pid = null;
async function pid(page) {
  if (_pid) return _pid;
  const data = await api(page, "GET", "/api/v1/personal/projects");
  const arr = Array.isArray(data) ? data : (data?.items ?? []);
  _pid = (arr.find((x) => x.name === "管理项目") ?? arr[0])?.id ?? null;
  return _pid;
}

async function findAgent(page, name) {
  const id = await pid(page);
  if (!id) return null;
  const data = await api(page, "GET", `/api/v1/projects/${id}/agents`);
  return (data?.items ?? []).find((a) => a.name === name) ?? null;
}

/** 镜尾补足分镜表时长（无配音时兜底；有配音时 narrate 已等够则跳过）。 */
async function padTo(t0, targetMs) {
  const remain = targetMs - (Date.now() - t0);
  if (remain > 300) await sleep(remain);
}

async function openAgentsPage(page, h) {
  await h.goto("/settings/agents");
  await page
    .getByTestId("agents-page")
    .waitFor({ state: "visible", timeout: 15000 })
    .catch(() => {});
  await sleep(600);
}

export const scenes = [
  // ── S3（30s）管理页总览：Agent 卡片列表 + 技能库/运行记录入口 ──
  {
    seg: "S3",
    run: async (page, h) => {
      const t0 = Date.now();
      try {
        await h.goto("/");
        await sleep(600);
        await h.expandGroup("项目设置");
        await page
          .getByTestId("nav-settings-agents")
          .first()
          .click()
          .catch(async () => {
            await h.goto("/settings/agents");
          });
        await page
          .getByTestId("agents-page")
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => {});
        await sleep(800);
        await h.narrate("S3");
        // 全景 1s → 卡片 spotlight（已有演示 Agent 则点亮其卡片）
        const demo = await findAgent(page, CHAT_AGENT);
        if (demo?.id) {
          await h.spotlight(`[data-testid="agent-card-${demo.id}"]`, 1500).catch(() => {});
          S.chatId = demo.id;
        } else {
          await h.spotlight(".grid", 1500).catch(() => {});
        }
        await h.spotlight('[data-testid="agent-create"]', 1200);
        // 技能库/运行记录入口扫过（工具栏 + Tabs）
        await h.spotlight('[data-testid="agent-skill-create"]', 900).catch(() => {});
        await h.spotlight(".ant-tabs-tab:nth-child(2)", 900).catch(() => {});
        await h.spotlight(".ant-tabs-tab:nth-child(3)", 900).catch(() => {});
        await h.reset();
      } catch (e) {
        console.warn(`[tutor-5.3] S3: ${e.message}`);
      }
      await padTo(t0, 30_000);
    },
  },

  // ── S4（40s）新建 Agent：抽屉表单（名称/系统提示词/模式/工具白名单）→ 保存 → 卡片出现 ──
  {
    seg: "S4",
    run: async (page, h) => {
      const t0 = Date.now();
      try {
        await openAgentsPage(page, h);
        await h.narrate("S4");
        const existed = await findAgent(page, CHAT_AGENT);
        const drawer = page.getByTestId("agent-edit-drawer");
        if (existed?.id) {
          // 存在即复用：打开编辑抽屉走查表单回显（不重复创建）
          S.chatId = existed.id;
          await page
            .getByTestId(`agent-card-${existed.id}`)
            .getByText("编辑", { exact: true })
            .click();
          await drawer.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
          await sleep(500);
          await h.spotlight('[data-testid="agent-form-name"]', 1200);
          await h.spotlight("#systemPrompt", 1200);
          await h.zoom('[data-testid="agent-edit-drawer"]', 1.12, 700);
          await sleep(600);
          await drawer
            .getByRole("button", { name: "取消" })
            .click()
            .catch(() => {});
          await sleep(600);
          await h.spotlight(`[data-testid="agent-card-${existed.id}"]`, 1500).catch(() => {});
        } else {
          await page.getByTestId("agent-create").click();
          await drawer.waitFor({ state: "visible", timeout: 8000 });
          await h.spotlight('[data-testid="agent-form-name"]', 1000);
          await h.type('[data-testid="agent-form-name"]', CHAT_AGENT);
          await sleep(400);
          await h.spotlight("#systemPrompt", 1000);
          await page
            .locator("#systemPrompt")
            .fill(
              "你是本项目的用例设计专家，按等价类与边界值方法设计测试用例，输出结构化步骤与预期。",
            );
          await sleep(400);
          // 运行模式（chat 对话 / pipeline 管线）与工具白名单 spotlight
          await h
            .spotlight('[data-testid="agent-edit-drawer"] .ant-select:nth-of-type(2)', 1000)
            .catch(() => {});
          const toolSel = drawer
            .locator(".ant-form-item")
            .filter({ hasText: "工具目录" })
            .locator(".ant-select")
            .first();
          await h
            .spotlight('[data-testid="agent-edit-drawer"] .ant-form-item:nth-last-of-type(3)', 900)
            .catch(() => {});
          await pickOption(page, toolSel, /module\.tree/); // 用例 · module.tree（S7 调试台要用）
          await sleep(400);
          const created = page.waitForResponse(
            (r) =>
              r.request().method() === "POST" && /\/agents\/?$/.test(new URL(r.url()).pathname),
            { timeout: 15000 },
          );
          await page.getByTestId("agent-edit-save").click();
          const res = await created.catch(() => null);
          const body = res ? await res.json().catch(() => null) : null;
          if (body?.data?.id) S.chatId = body.data.id;
          await sleep(800);
          if (S.chatId) {
            await page
              .getByTestId(`agent-card-${S.chatId}`)
              .waitFor({ state: "visible", timeout: 10000 })
              .catch(() => {});
            await h.spotlight(`[data-testid="agent-card-${S.chatId}"]`, 1500).catch(() => {});
          }
          await h.reset();
        }
      } catch (e) {
        console.warn(`[tutor-5.3] S4: ${e.message}`);
      }
      await padTo(t0, 40_000);
    },
  },

  // ── S5（25s）A2A 密钥：生成 → rag_ 前缀特写（UI 无密钥按钮，API 生成后卡片展示） ──
  {
    seg: "S5",
    run: async (page, h) => {
      const t0 = Date.now();
      try {
        await openAgentsPage(page, h);
        await h.narrate("S5");
        const id = S.chatId ?? (await findAgent(page, CHAT_AGENT))?.id;
        if (!id) {
          console.warn("[tutor-5.3] S5: 找不到演示 Agent，跳过");
          return;
        }
        const card = page.getByTestId(`agent-card-${id}`);
        // 分镜假设卡片上有「生成密钥」按钮——当前 UI 未接线，先探测（合入后自动走 UI 路径）
        const keyBtn = card.getByRole("button", { name: /生成密钥|轮换|密钥/ });
        if (await keyBtn.count().catch(() => 0)) {
          await keyBtn.first().click();
          await page
            .getByTestId("agent-key-plaintext")
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => {});
          await h.spotlight('[data-testid="agent-key-plaintext"]', 1800).catch(() => {});
          await page.keyboard.press("Escape");
        } else {
          // 勘误路径：API 生成（POST a2a-key → rag_ 前缀）→ 刷新后卡片底部「密钥 rag_…」特写
          const p = await pid(page);
          const key = await api(page, "POST", `/api/v1/projects/${p}/agents/${id}/a2a-key`);
          console.log(
            `[tutor-5.3] S5 密钥前缀：${(key?.apiKey ?? "").slice(0, 8)}…（一次性值不入镜）`,
          );
          await page.reload();
          await page
            .getByTestId("agents-page")
            .waitFor({ state: "visible", timeout: 15000 })
            .catch(() => {});
          await sleep(800);
          await h.spotlight(`[data-testid="agent-card-${id}"]`, 1400).catch(() => {});
          await h.zoom(`[data-testid="agent-card-${id}"]`, 1.3, 700);
          await sleep(600);
          await h.reset();
        }
      } catch (e) {
        console.warn(`[tutor-5.3] S5: ${e.message}`);
      }
      await padTo(t0, 25_000);
    },
  },

  // ── S6（30s）技能库：模板下载 → zip 上传（AGENT-005）→ 技能卡出现 → 编辑抽屉引用 ──
  {
    seg: "S6",
    run: async (page, h) => {
      const t0 = Date.now();
      try {
        await openAgentsPage(page, h);
        await h.narrate("S6");
        const p = await pid(page);
        // ① 技能 tab
        await page.getByRole("tab", { name: "技能" }).click();
        await sleep(900);
        const skills = await api(page, "GET", `/api/v1/projects/${p}/agent-skills`);
        const hasTpl = (skills?.items ?? []).some((s) => s.name === TPL_SKILL);
        // ② 模板下载（<a download> → 真实落盘 /tmp，供上传复用）
        await h.spotlight('[data-testid="agent-skill-template"]', 1200);
        try {
          const [dl] = await Promise.all([
            page.waitForEvent("download", { timeout: 6000 }),
            page.getByTestId("agent-skill-template").click(),
          ]);
          await dl.saveAs(ZIP_PATH);
        } catch {
          /* 下载事件未捕获时走 API 兜底 */
        }
        if (!existsSync(ZIP_PATH)) {
          const r = await page.request.get(`${WEB}/api/v1/projects/${p}/agent-skills/template`);
          if (r.ok()) await writeFile(ZIP_PATH, Buffer.from(await r.body()));
        }
        // ③ zip 上传（存在即复用——技能表已有 my-skill 则跳过真上传）
        await h.spotlight('[data-testid="agent-skill-upload"]', 1000);
        if (!hasTpl && existsSync(ZIP_PATH)) {
          const [fc] = await Promise.all([
            page.waitForEvent("filechooser"),
            page.getByTestId("agent-skill-upload").click(),
          ]);
          await fc.setFiles(ZIP_PATH);
          await page
            .getByText(TPL_SKILL)
            .first()
            .waitFor({ state: "visible", timeout: 10000 })
            .catch(() => {});
          await sleep(600);
        }
        await h.zoom(".ant-table-container", 1.15, 700).catch(() => {});
        await sleep(500);
        await h.reset();
        // ④ 回到 Agent 编辑抽屉引用该技能（Skills(≤5) 多选）
        const id = S.chatId ?? (await findAgent(page, CHAT_AGENT))?.id;
        if (id) {
          await page.getByRole("tab", { name: "Agent", exact: true }).click();
          await sleep(600);
          await page.getByTestId(`agent-card-${id}`).getByText("编辑", { exact: true }).click();
          const drawer = page.getByTestId("agent-edit-drawer");
          await drawer.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
          const skillSel = drawer
            .locator(".ant-form-item")
            .filter({ hasText: "Skills" })
            .locator(".ant-select")
            .first();
          await pickOption(page, skillSel, new RegExp(TPL_SKILL));
          await sleep(400);
          await page.getByTestId("agent-edit-save").click(); // PUT 200（引用落库）
          await sleep(900);
        }
      } catch (e) {
        console.warn(`[tutor-5.3] S6: ${e.message}`);
      }
      await padTo(t0, 30_000);
    },
  },

  // ── S7（40s）调试台：发「查询模块树并给一句话总结」→ SSE 轨迹 → 终态 → 运行记录 +1 ──
  {
    seg: "S7",
    run: async (page, h) => {
      const t0 = Date.now();
      try {
        const id = S.chatId ?? (await findAgent(page, CHAT_AGENT))?.id;
        if (!id) {
          console.warn("[tutor-5.3] S7: 找不到演示 Agent，跳过");
          return;
        }
        await h.goto(`/settings/agents/${id}/debug`);
        await page
          .getByTestId("agent-debug-page")
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => {});
        // 等 Agent 名称渲染（projectId 已水合再交互，AGENT-001-02 CI 教训）
        await page
          .getByText(CHAT_AGENT)
          .first()
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => {});
        await sleep(500);
        await h.narrate("S7");
        await h.spotlight('[data-testid="agent-debug-input"]', 1200);
        await h.type('[data-testid="agent-debug-input"]', "查询模块树并给一句话总结");
        await sleep(400);
        await page.getByTestId("agent-debug-send").click();
        // 工作目录准备帧（SSE：platform-docs 同步 / 任务目录创建）
        await page
          .getByText(/platform-docs 同步|任务目录 tasks\//)
          .first()
          .waitFor({ state: "visible", timeout: 60_000 })
          .catch(() => {});
        await h.zoom(".w-80", 1.2, 700).catch(() => {}); // 右侧轨迹区滚动跟随
        await sleep(600);
        // 等终态（≤60s 上限；录制时模型慢可 2x 提速并角标）
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          const ended = await page.getByText("运行结束").count();
          const answered = await page.locator("div.whitespace-pre-wrap").count();
          if (ended > 0 || answered > 0) break;
          await sleep(1500);
        }
        await sleep(800);
        await h.reset();
        // 回管理页：运行记录 +1
        await openAgentsPage(page, h);
        await page.getByRole("tab", { name: "运行记录" }).click();
        await sleep(1000);
        await h.spotlight(".ant-table-tbody tr:nth-child(1)", 1500).catch(() => {});
        await h.reset();
      } catch (e) {
        console.warn(`[tutor-5.3] S7: ${e.message}`);
      }
      await padTo(t0, 40_000);
    },
  },

  // ── S8（40s）生成向导（pipeline Agent）：上下文源 → 取消 B/C 阶段 → 开始 → 等终态 ──
  {
    seg: "S8",
    run: async (page, h) => {
      const t0 = Date.now();
      try {
        const p = await pid(page);
        let ag = await findAgent(page, PIPE_AGENT);
        if (!ag) {
          const created = await api(page, "POST", `/api/v1/projects/${p}/agents`, {
            name: PIPE_AGENT,
            systemPrompt: "根据需求文本与项目文档生成测试用例草稿。",
            mode: "pipeline",
            role: "CUSTOM",
          });
          ag = created ? { id: created.id } : null;
        }
        if (!ag?.id) {
          console.warn("[tutor-5.3] S8: pipeline Agent 创建失败，跳过");
          return;
        }
        S.pipeId = ag.id;
        await h.goto(`/settings/agents/${ag.id}/generate`);
        await page
          .getByTestId("generate-wizard-page")
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => {});
        await h.narrate("S8");
        // ① 上下文源：需求文本（约 100 字，登录模块测试要点）
        await h.spotlight('[data-testid="generate-requirement-input"]', 1200);
        await page
          .getByTestId("generate-requirement-input")
          .fill(
            "登录模块测试要点：覆盖正确账号密码登录成功跳转、错误密码提示与次数限制、账号锁定与恢复、验证码刷新与校验、记住登录态与过期、多端同时登录互踢等场景。",
          );
        await sleep(400);
        await page.getByTestId("generate-next-stages").click();
        await page
          .getByTestId("generate-step-stages")
          .waitFor({ state: "visible", timeout: 8000 })
          .catch(() => {});
        await sleep(600);
        // ② 阶段勾选：控制时长只留阶段 A（e2e 同法取消 B/C）
        await page
          .getByTestId("generate-stage-b")
          .uncheck()
          .catch(() => {});
        await sleep(300);
        await page
          .getByTestId("generate-stage-c")
          .uncheck()
          .catch(() => {});
        await sleep(400);
        await h.spotlight('[data-testid="generate-stage-a"]', 1200);
        // ③ 开始生成
        const started = page.waitForResponse(
          (r) => r.request().method() === "POST" && r.url().includes("/generate"),
          { timeout: 20000 },
        );
        await page.getByTestId("generate-start").click();
        const res = await started.catch(() => null);
        const body = res ? await res.json().catch(() => null) : null;
        S.runId = body?.data?.runId ?? null;
        await page
          .getByTestId("generate-step-run")
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => {});
        // 运行进度轮询至终态（≤120s；COMPLETED/FAILED 皆为合法终态——mock 模型兼容）
        if (S.runId) {
          const deadline = Date.now() + 120_000;
          while (Date.now() < deadline) {
            const d = await api(page, "GET", `/api/v1/projects/${p}/agent-runs/${S.runId}`);
            if (["COMPLETED", "FAILED", "CANCELED"].includes(d?.run?.status ?? "")) break;
            await sleep(2000);
          }
        }
        await sleep(800);
        // 跳产物预览（COMPLETED 时点「查看产物」，兜底直达 URL）
        S.draftsPath = `/settings/agents/${ag.id}/runs/${S.runId}/drafts`;
        const seeBtn = page.getByRole("button", { name: "查看产物" });
        if (await seeBtn.count().catch(() => 0)) await seeBtn.click();
        else if (S.runId) await h.goto(S.draftsPath);
      } catch (e) {
        console.warn(`[tutor-5.3] S8: ${e.message}`);
      }
      await padTo(t0, 40_000);
    },
  },

  // ── S9（30s）产物预览：草稿表格 → 勾选 2 条 → 导入按钮态变化 → 导入 → /cases 验证 ──
  {
    seg: "S9",
    run: async (page, h) => {
      const t0 = Date.now();
      try {
        const p = await pid(page);
        // 重录单镜兜底：pipeline Agent 最近一次运行的草稿路径
        if (!S.draftsPath || !S.runId) {
          const ag = await findAgent(page, PIPE_AGENT);
          if (ag?.id) {
            S.pipeId = ag.id;
            const runs = await api(
              page,
              "GET",
              `/api/v1/projects/${p}/agents/${ag.id}/runs?page=1&pageSize=5`,
            );
            const latest = (runs?.items ?? [])[0];
            if (latest?.id) {
              S.runId = latest.id;
              S.draftsPath = `/settings/agents/${ag.id}/runs/${latest.id}/drafts`;
            }
          }
        }
        if (!S.draftsPath) {
          console.warn("[tutor-5.3] S9: 无生成运行，跳过");
          return;
        }
        await h.goto(S.draftsPath);
        await page
          .getByTestId("drafts-page")
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => {});
        await sleep(800);
        await h.narrate("S9");
        const table = page.getByTestId("drafts-table");
        if (await table.isVisible().catch(() => false)) {
          const boxes = page.locator('[data-testid^="draft-check-"]');
          const n = Math.min(2, await boxes.count());
          // 未勾选时禁用态 → 勾选 → 可用态（分镜的按钮态变化）
          await h.spotlight('[data-testid="drafts-import-btn"]', 1200);
          for (let i = 0; i < n; i++) {
            await boxes.nth(i).click();
            await sleep(350);
          }
          await sleep(400);
          await h.spotlight('[data-testid="drafts-import-btn"]', 1400);
          await page.getByTestId("drafts-import-btn").click();
          await page
            .getByText(/导入完成/)
            .first()
            .waitFor({ state: "visible", timeout: 15000 })
            .catch(() => {});
          await sleep(800);
          // /cases 验证（呼应 2.2 用例列表同页）
          await h.goto("/cases");
          await page
            .locator("table")
            .first()
            .waitFor({ state: "visible", timeout: 15000 })
            .catch(() => {});
          await sleep(1000);
          await h.spotlight(".ant-table-tbody tr:nth-child(1)", 1600).catch(() => {});
        } else {
          // 无草稿（mock 模型不产出）——空态提示入镜
          await h.spotlight(".ant-alert", 1600).catch(() => {});
        }
        await h.reset();
      } catch (e) {
        console.warn(`[tutor-5.3] S9: ${e.message}`);
      }
      await padTo(t0, 30_000);
    },
  },
];
