/**
 * AGENT-001 §4.4 pi 会话适配器（AgentRuntimeKernel 薄层——宿主可换，域层不动）：
 * 进程内 SDK 嵌入（pi 1.0 createAgentSession）：cwd=tasks/{runId}；模型经临时 models.json
 * 注入（baseUrl+apiKey 只存于 Run 临时目录，Run 结束即焚）；原生工具白名单=read/ls/grep/find
 * （只读探索工作区；bash/edit/write 关闭——写路径护栏 v1 不开）；平台工具经 customTools 桥
 * 回本进程执行（zod 校验/权限断言/截断在桥内——§2.2 口径）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { ZodTypeAny } from "zod";
import { zodToJsonSchemaShape } from "@rabbit/shared";

type PiEvent = { type: string } & Record<string, unknown>;

export interface PiModelConfig {
  /** pi-ai provider id（如 rabbit-<modelId8>） */
  providerId: string;
  baseUrl: string;
  apiKey: string;
  /** 模型名（如 glm-4.6） */
  modelId: string;
  maxTokens: number;
}

export interface PiRunOptions {
  taskDir: string;
  /** 临时 agentDir（.pi/：models.json + auth.json；Run 结束整目录清理） */
  agentDir: string;
  userMessage: string;
  model: PiModelConfig;
  /** 平台工具目录子集 */
  tools: { key: string; title: string; description: string; write: boolean; input: ZodTypeAny }[];
  /** 工具执行桥（校验/权限/截断在调用方） */
  callTool: (
    key: string,
    input: Record<string, unknown>,
  ) => Promise<{ ok: boolean; result: unknown }>;
  onEvent: (e: PiEvent) => void;
}

export interface PiRunResult {
  finalText: string;
  promptTokens: number;
  completionTokens: number;
  iterations: number;
}

/** 写临时 models.json（apiKey 不落 Run 目录之外） */
async function writeModelConfig(agentDir: string, model: PiModelConfig): Promise<void> {
  await fs.mkdir(agentDir, { recursive: true });
  const cfg = {
    providers: {
      [model.providerId]: {
        name: model.providerId,
        baseUrl: model.baseUrl.replace(/\/+$/, ""),
        apiKey: model.apiKey,
        api: "openai-completions",
        authHeader: true,
        models: [
          {
            id: model.modelId,
            name: model.modelId,
            maxTokens: Math.min(model.maxTokens, 32768),
            contextWindow: 131072,
          },
        ],
      },
    },
  };
  await fs.writeFile(path.join(agentDir, "models.json"), JSON.stringify(cfg), "utf8");
  await fs.writeFile(path.join(agentDir, "auth.json"), "{}", "utf8");
}

/** 单次 Run 的 pi 会话执行；异常向上抛（run.service 统一转 Run FAILED）。 */
export async function runPiSession(opts: PiRunOptions): Promise<PiRunResult> {
  await writeModelConfig(opts.agentDir, opts.model);
  const pi = (await import("@earendil-works/pi-coding-agent")) as unknown as {
    ModelRuntime: { create: (o: unknown) => Promise<unknown> };
    createAgentSession: (o: unknown) => Promise<{ session: unknown }>;
  };

  const customTools = opts.tools.map((t) => ({
    name: t.key,
    description: `${t.title}：${t.description}${t.write ? "（写操作）" : ""}`,
    parameters: zodToJsonSchemaShape(t.input),
    async execute(input: Record<string, unknown>) {
      const r = await opts.callTool(t.key, input);
      return r.result; // 错误说明也回传（LLM 自纠）
    },
  }));

  const modelRuntime = await pi.ModelRuntime.create({
    modelsPath: path.join(opts.agentDir, "models.json"),
    authPath: path.join(opts.agentDir, "auth.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const models = modelRuntime as { getModel: (providerId: string, modelId: string) => unknown };
  const model = models.getModel(opts.model.providerId, opts.model.modelId);
  if (!model) throw new Error(`pi 无法解析模型 ${opts.model.providerId}/${opts.model.modelId}`);

  const { session } = await pi.createAgentSession({
    cwd: opts.taskDir,
    agentDir: opts.agentDir,
    model,
    modelRuntime,
    // 只读白名单：read/ls/grep/find（bash/edit/write 关闭——§4.4 只读护栏 v1）
    tools: ["read", "ls", "grep", "find"],
    customTools,
  });

  const s = session as {
    prompt: (text: string) => Promise<unknown>;
    addEventListener: (l: (e: PiEvent) => void) => void;
    dispose?: () => Promise<void> | void;
  };

  let promptTokens = 0;
  let completionTokens = 0;
  let iterations = 0;
  s.addEventListener((event) => {
    opts.onEvent(event);
    const usage = (event as { usage?: { input?: number; output?: number } }).usage;
    if (usage) {
      promptTokens += usage.input ?? 0;
      completionTokens += usage.output ?? 0;
    }
    if (event.type === "turn_start") iterations++;
  });

  try {
    const result = (await s.prompt(opts.userMessage)) as {
      result?: { text?: string; usage?: { input?: number; output?: number } };
    };
    if (result?.result?.usage) {
      promptTokens += result.result.usage.input ?? 0;
      completionTokens += result.result.usage.output ?? 0;
    }
    return { finalText: result?.result?.text ?? "", promptTokens, completionTokens, iterations };
  } finally {
    await Promise.resolve(s.dispose?.()).catch(() => {});
  }
}
