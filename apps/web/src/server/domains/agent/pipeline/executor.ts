/**
 * AGENT-002 管线执行器：pi 会话驱动三阶段（A→B→C 顺序消息）+ draft.submit 工具桥。
 * ensure 工作目录 → pi 会话（cwd=tasks/{runId}）→ 逐阶段消息 → 草稿行级写入 → 终态。
 */
import path from "node:path";
import fs from "node:fs/promises";
import {
  AGENT_TOOL_MAP,
  CONTEXT_SCORING,
  type ContextBundle,
  type ContextFile,
  type ContextSource,
  type GenRunRequest,
  type PipelineStage,
  DomainError,
  ErrCode,
} from "@rabbit/shared";
import { prisma, runAsAdmin } from "@rabbit/db";
import { logFor } from "@rabbit/shared/logger";
import { resolveRuntime } from "@/server/domains/ai/model.service";
import { agentQueue, redis } from "@/server/redis";
import { ensureWorkspace, agentWsDir, type EnsureStep } from "../workspace";
import { runPiSession } from "../pi-session";
import { executeTool, truncateToolResult, type ToolCtx } from "../tools/index";
import { permissionSetFor } from "@/server/rbac";
import { saveDraft } from "./drafts.service";

// ── 启动管线（POST /generate） ──

export async function startPipelineRun(
  projectId: string,
  agentId: string,
  userId: string,
  input: GenRunRequest,
): Promise<{ runId: string }> {
  const agent = await prisma.projectAgent.findFirst({
    where: { id: agentId, projectId, deletedAt: null, enabled: true, mode: "pipeline" },
  });
  if (!agent) throw new DomainError(ErrCode.AGENT_NOT_FOUND, "Agent 不存在或非 pipeline 模式");
  if (!agent.enabled) throw new DomainError(ErrCode.AGENT_DISABLED, "Agent 已停用");

  // 源校验（三源全空 → 422）
  const { repoIds = [], docPaths = [], platformDocIds = [], requirementText } = input.sources;
  if (!repoIds.length && !docPaths.length && !platformDocIds.length && !requirementText?.trim()) {
    throw new DomainError(ErrCode.AGENT_GEN_SOURCE_EMPTY, "仓库/平台文档/需求文本至少一项");
  }

  // 并发互斥
  const running = await prisma.agentRun.findFirst({
    where: { agentId, status: { in: ["PENDING", "RUNNING"] } },
    select: { id: true },
  });
  if (running) throw new DomainError(70841, "该 Agent 已有进行中的生成任务");

  const model = await resolveRuntime(agent.modelId);

  const run = await prisma.agentRun.create({
    data: {
      projectId,
      agentId,
      source: "UI",
      contextId: `gen-${Date.now()}`,
      asUserId: userId,
      status: "PENDING",
      input: input as object,
      snapshot: JSON.parse(
        JSON.stringify({
          modelId: agent.modelId,
          systemPrompt: agent.systemPrompt,
          modelParams: (agent.modelParams ?? {}) as Record<string, unknown>,
          maxIterations: agent.maxIterations,
          timeoutMs: agent.timeoutMs,
          mode: "pipeline",
          repoIds: (agent.repoIds ?? []) as string[],
          runAsUserId: agent.runAsUserId,
          pipelineInput: input,
        }),
      ) as object,
      triggerUserId: userId,
    },
  });

  setTimeout(() => {
    void agentQueue()
      .add(
        "pipeline",
        { runId: run.id },
        { jobId: run.id, removeOnComplete: 500, removeOnFail: 500 },
      )
      .catch(() => {});
  }, 200);

  return { runId: run.id };
}

// ── 管线处理器（worker 调用） ──

export async function processPipelineRun(runId: string): Promise<void> {
  await runAsAdmin(async () => {
    const run = await prisma.agentRun.findUnique({ where: { id: runId } });
    if (!run || run.status !== "PENDING") return;
    const agent = await prisma.projectAgent.findUnique({ where: { id: run.agentId } });
    if (!agent) return;

    const snapshot = run.snapshot as {
      modelId: string;
      systemPrompt: string;
      modelParams: { temperature?: number; maxTokens?: number };
      maxIterations: number;
      timeoutMs: number;
      repoIds: string[];
      runAsUserId: string;
      pipelineInput: GenRunRequest;
    };
    const input = snapshot.pipelineInput;
    const startedAt = new Date();
    await prisma.agentRun.update({ where: { id: runId }, data: { status: "RUNNING", startedAt } });

    const log = logFor("agent-pipeline");
    try {
      // ① 工作目录 ensure
      const step = (s: EnsureStep) => {
        void prisma.agentRunMessage
          .create({
            data: { runId, seq: Date.now(), role: "tool", name: "workspace", content: s as object },
          })
          .catch(() => {});
      };
      const repos = (input.sources.repoIds ?? []).map((r) => ({
        repoId: r.repoId,
        branch: r.branch,
      }));
      const { taskDir, wsDir } = await ensureWorkspace(
        { projectId: run.projectId, agentId: agent.id, runId, repos },
        step,
      );

      // ② 写 AGENTS.md（pi 项目上下文）
      await fs.writeFile(path.join(taskDir, "AGENTS.md"), snapshot.systemPrompt, "utf8");

      // ③ 草稿提交工具桥
      const perms = await permissionSetFor(run.asUserId, { projectId: run.projectId }).catch(
        () => new Set<string>(),
      );
      const toolCtx: ToolCtx = { projectId: run.projectId, userId: run.asUserId, runId, wsDir };
      const draftCounter = { count: 0 };
      const limits = input.limits ?? { cases: 50, apis: 100, scenarios: 30 };

      const customTools: {
        key: string;
        title: string;
        description: string;
        write: boolean;
        input: never;
      }[] = [
        {
          key: "draft.submit",
          title: "提交生成草稿",
          description: `提交一条测试资产草稿（assetType + payload）；每次一条；超上限拒收。可用类型：functional_case/test_point/api_definition/api_case/scenario/ui_case/playwright_script。上限：功能用例 ${limits.cases}、接口 ${limits.apis}、场景 ${limits.scenarios}。`,
          write: true,
          input: null as never,
        },
      ];

      const callTool = async (
        key: string,
        toolInput: Record<string, unknown>,
      ): Promise<{ ok: boolean; result: unknown }> => {
        if (key === "draft.submit") {
          return await handleDraftSubmit(run.projectId, runId, toolInput, limits, draftCounter);
        }
        const def = AGENT_TOOL_MAP.get(key);
        if (!def) return { ok: false, result: { error: `未知工具 ${key}` } };
        const assertPerm = async (point: string) => {
          if (!perms.has(point)) throw new Error(`执行身份缺少权限点 ${point}`);
        };
        const r = await executeTool(key, toolInput, toolCtx, assertPerm).catch((e: Error) => ({
          ok: false,
          result: { error: e.message },
          def: null as unknown as typeof def,
        }));
        return { ok: r.ok, result: truncateToolResult(r.result) };
      };

      // ④ pi 会话（三阶段顺序消息）
      const piAgentDir = path.join(wsDir, ".pi");
      const model = await resolveRuntime(snapshot.modelId);
      const stages = buildStageMessages(input, snapshot.systemPrompt);
      let promptTokens = 0;
      let completionTokens = 0;

      for (const stage of stages) {
        // stage-start 帧
        await prisma.agentRunMessage
          .create({
            data: {
              runId,
              seq: Date.now(),
              role: "tool",
              name: "stage",
              content: { stage: stage.stage, event: "start" },
            },
          })
          .catch(() => {});

        const result = await runPiSession({
          taskDir,
          agentDir: piAgentDir,
          userMessage: stage.message,
          model: {
            providerId: `rabbit-${model.id.slice(0, 8)}`,
            baseUrl: model.baseUrl,
            apiKey: model.apiKey,
            modelId: model.model,
            maxTokens: snapshot.modelParams.maxTokens ?? 8192,
          },
          tools: customTools.filter((t) => t.key !== "draft.submit"),
          callTool,
          onEvent: (e) => {
            if (e.type === "message_end") {
              const usage = (e as { usage?: { input?: number; output?: number } }).usage;
              if (usage) {
                promptTokens += usage.input ?? 0;
                completionTokens += usage.output ?? 0;
              }
            }
          },
        }).catch((e: Error) => {
          log.warn(
            { runId, stage: stage.stage, err: e.message },
            "stage pi session failed (non-fatal)",
          );
          return { finalText: "", promptTokens: 0, completionTokens: 0, iterations: 0 };
        });

        promptTokens += result.promptTokens;
        completionTokens += result.completionTokens;

        // stage-end 帧
        await prisma.agentRunMessage
          .create({
            data: {
              runId,
              seq: Date.now(),
              role: "tool",
              name: "stage",
              content: { stage: stage.stage, event: "end", drafts: draftCounter.count },
            },
          })
          .catch(() => {});
      }

      // ⑤ 终态
      const draftCount = await prisma.agentGenDraft.count({ where: { runId } });
      await prisma.agentRun.update({
        where: { id: runId },
        data: {
          status: "COMPLETED",
          output: { counts: { drafts: draftCount } },
          promptTokens,
          completionTokens,
          durationMs: Date.now() - startedAt.getTime(),
          finishedAt: new Date(),
        },
      });
      await emitPipelineFrame(runId, "final", { status: "COMPLETED", drafts: draftCount });
    } catch (e) {
      const message = (e as Error).message ?? "管线失败";
      await prisma.agentRun
        .update({
          where: { id: runId },
          data: {
            status: "FAILED",
            error: message.slice(0, 1024),
            durationMs: Date.now() - startedAt.getTime(),
            finishedAt: new Date(),
          },
        })
        .catch(() => {});
      await emitPipelineFrame(runId, "final", { status: "FAILED", error: message }).catch(() => {});
      log.error({ runId, err: message }, "pipeline failed");
    } finally {
      const wsDir = agentWsDir(agent.id);
      await fs.rm(path.join(wsDir, ".pi"), { recursive: true, force: true }).catch(() => {});
    }
  });
}

// ── draft.submit 处理 ──

async function handleDraftSubmit(
  projectId: string,
  runId: string,
  input: Record<string, unknown>,
  limits: { cases: number; apis: number; scenarios: number },
  counter: { count: number },
): Promise<{ ok: boolean; result: unknown }> {
  const assetType = String(input.assetType ?? "");
  const stage = String(input.stage ?? "A") as PipelineStage;
  const payload = (input.payload ?? {}) as Record<string, unknown>;
  const name = String(payload.name ?? payload.title ?? "未命名");

  // 上限
  const caps: Record<string, number> = {
    functional_case: limits.cases,
    test_point: limits.cases,
    api_definition: limits.apis,
    api_case: limits.apis,
    scenario: limits.scenarios,
    ui_case: limits.scenarios,
    playwright_script: limits.scenarios,
  };
  const cap = caps[assetType];
  if (cap != null && counter.count >= cap) {
    return { ok: false, result: { error: `草稿总数已达上限 ${cap}（${assetType}）` } };
  }

  const draft = await saveDraft(projectId, runId, stage, assetType, name, payload);
  counter.count++;
  return { ok: true, result: { id: draft.id, conflictStatus: draft.conflictStatus } };
}

// ── 阶段消息构建 ──

interface StageMessage {
  stage: PipelineStage;
  message: string;
}

export function buildStageMessages(input: GenRunRequest, systemPrompt: string): StageMessage[] {
  const msgs: StageMessage[] = [];
  const stages = input.stages ?? {
    a: true,
    b: "auto",
    c: { scenario: true, ui: true, playwright: true },
  };
  const instruction = input.additionalInstruction ?? "";

  if (stages.a !== false) {
    msgs.push({
      stage: "A",
      message: [
        `## 阶段 A：需求分析`,
        `请阅读工作目录中的文档（platform-docs/ 和 repos/ 内的 docs 文件），结合以下需求文本，输出测试点和功能用例草稿。`,
        input.sources.requirementText ? `\n### 需求文本\n${input.sources.requirementText}` : "",
        instruction ? `\n### 附加指令\n${instruction}` : "",
        `\n### 输出方式`,
        `对每条测试点调用 draft.submit（assetType="test_point"），对每条功能用例调用 draft.submit（assetType="functional_case"）。`,
        `功能用例必须包含 name/precondition/steps（步骤+预期）/level。`,
      ].join("\n"),
    });
  }

  if (stages.b !== "off") {
    msgs.push({
      stage: "B",
      message: [
        `## 阶段 B：接口资产提取`,
        stages.b === "openapi"
          ? `从工作目录中的 OpenAPI/Swagger 文件提取接口定义。`
          : `从工作目录中的代码或 OpenAPI 文件提取接口定义和 API 用例。`,
        `对每条接口调用 draft.submit（assetType="api_definition"），包含 name/method/path。`,
        `对每条 API 用例调用 draft.submit（assetType="api_case"），包含 name/method/path/断言。`,
        instruction ? `\n附加指令：${instruction}` : "",
      ].join("\n"),
    });
  }

  if (stages.c) {
    const forms: string[] = [];
    if (stages.c.scenario !== false) forms.push("scenario（步骤树）");
    if (stages.c.ui !== false) forms.push("ui_case（八指令）");
    if (stages.c.playwright !== false) forms.push("playwright_script");
    if (forms.length) {
      msgs.push({
        stage: "C",
        message: [
          `## 阶段 C：脚本生成`,
          `基于阶段 A/B 的产物，生成可执行测试脚本。产物形态：${forms.join("、")}。`,
          `对每条场景调用 draft.submit（assetType="scenario"），包含 name/steps。`,
          `对每条 UI 用例调用 draft.submit（assetType="ui_case"），步骤用 op 枚举。`,
          instruction ? `\n附加指令：${instruction}` : "",
        ].join("\n"),
      });
    }
  }

  return msgs;
}

// ── SSE 帧 ──

async function emitPipelineFrame(runId: string, type: string, payload: unknown): Promise<void> {
  const { agentRunStreamKey } = await import("@/server/redis");
  await redis()
    .xadd(
      agentRunStreamKey(runId),
      "MAXLEN",
      "~",
      2000,
      "*",
      "type",
      type,
      "payload",
      JSON.stringify(payload ?? null),
    )
    .catch(() => {});
}

// ── 上下文装配（向导预估用） ──

export function scoreFile(filePath: string, bytes: number, keywords: string[]): number {
  let score = 0;
  const ext = path.extname(filePath).toLowerCase();
  if (
    CONTEXT_SCORING.textExtensions.includes(ext as (typeof CONTEXT_SCORING.textExtensions)[number])
  )
    score += CONTEXT_SCORING.extensionBonus;
  const dirPaths = ["src/api", "routes", "controller", "endpoint", "test", "spec", "docs"];
  if (dirPaths.some((d) => filePath.includes(d))) score += CONTEXT_SCORING.directoryBonus;
  const fileName = path.basename(filePath).toLowerCase();
  if (
    keywords.some(
      (kw) =>
        fileName.includes(kw.toLowerCase()) || filePath.toLowerCase().includes(kw.toLowerCase()),
    )
  ) {
    score += CONTEXT_SCORING.keywordBonus;
  }
  if (CONTEXT_SCORING.excludedPatterns.some((p) => filePath.includes(p))) return -999;
  if (bytes > 64 * 1024) score += CONTEXT_SCORING.sizePenalty;
  return score;
}

export async function previewContext(
  projectId: string,
  sources: ContextSource,
): Promise<{
  hitFiles: number;
  tokenEstimate: number;
  truncated: boolean;
  manifest: ContextFile[];
}> {
  const manifest: ContextFile[] = [];
  let tokens = 0;
  const maxTokens = 48_000;

  // 仓库文件估算（简化：用已绑定仓库的元信息）
  if (sources.repoIds?.length) {
    const repoIds = sources.repoIds.map((r) => r.repoId);
    const repos = await prisma.scmRepository.findMany({
      where: { projectId, deletedAt: null, id: { in: repoIds } },
      select: { id: true, owner: true, repo: true },
    });
    for (const r of repos) {
      manifest.push({
        path: `repos/${r.owner}__${r.repo}/`,
        score: 30,
        bytes: 0,
        truncated: false,
      });
    }
  }

  // 平台文档
  if (sources.platformDocIds?.length) {
    const docs = await prisma.fileItem.findMany({
      where: { projectId, deletedAt: null, id: { in: sources.platformDocIds } },
      select: { name: true, size: true },
    });
    for (const d of docs) {
      const t = Math.ceil(d.size / 4);
      manifest.push({
        path: `platform-docs/${d.name}`,
        score: 40,
        bytes: d.size,
        truncated: false,
      });
      tokens += t;
    }
  }

  if (sources.requirementText) tokens += Math.ceil(sources.requirementText.length / 4);

  return {
    hitFiles: manifest.length,
    tokenEstimate: tokens,
    truncated: tokens > maxTokens,
    manifest,
  };
}
