/** EXEC-002/API-004 runner v2：api_debug 单请求 + api_case 批量（串行/失败停止/停止信号/变量链）。 */
import { config, execCommandSchema, execStopKey } from "@rabbit/shared";
import type {
  AssertSpec,
  EnvSnapshot,
  ExecCallback,
  ExecCommand,
  Extractor,
  Processor,
  RequestSpec,
} from "@rabbit/shared/execution";
import { heartbeatResponseSchema } from "@rabbit/shared/execution";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { EventWriter } from "../events.js";
import { postCallback } from "../callback.js";
import { evaluateAsserts, classifyFailure } from "../kernel/asserts.js";
import { runExtractors } from "../kernel/extract.js";
import { ProcessorError, runProcessors } from "../kernel/processors.js";
import { hostsMap, mergeGlobals, renderRequest, resolveUrl } from "../kernel/render.js";
import { httpSample } from "../samplers/http.js";

const NODE_ID = `node-${process.pid}`;
const VERSION = "0.2.0"; // 契约 v2（心跳协商：web 侧 0.1 → UNMATCHED 展示）

interface StepSpec {
  itemId?: string;
  name?: string;
  moduleId?: string;
  request: RequestSpec;
  asserts: AssertSpec[];
  pre: Processor[];
  post: Processor[];
  extracts: Extractor[];
}

type StepOutcome = { status: "SUCCESS" | "FAILED" | "STOPPED"; failureKind?: string; message: string };

/** 单步管线：渲染 → 前置 → 采样 → 提取 → 断言 → 后置（API-004 §2；环境全局区并入）。 */
async function runStep(
  redis: Redis,
  writer: EventWriter,
  env: EnvSnapshot | undefined,
  tempVars: Record<string, string>,
  step: StepSpec,
  envVarUpdates: { name: string; value: string }[],
): Promise<StepOutcome> {
  const vars = { ...(env?.vars ?? {}), ...tempVars };
  const ctx = { vars, env, moduleId: step.moduleId };
  const log = async (level: "info" | "warn" | "error", message: string) => {
    await writer.emit({ type: "log", level, message, ...(step.itemId ? { itemId: step.itemId } : {}) });
  };
  const pre = step.request.skipPre ? [] : mergeGlobals(env?.pre, step.pre);
  const post = step.request.skipPost ? [] : [...step.post, ...(env?.post ?? [])];
  // 提取器：环境全局在前（供后续断言/脚本消费）
  const extracts = mergeGlobals(env?.extracts, step.extracts);
  const asserts = mergeGlobals([], step.asserts).concat(env?.asserts ?? []);

  try {
    const rendered = renderRequest(step.request, ctx);
    const url = resolveUrl(rendered, ctx);
    await writer.emit({
      type: "step-start",
      method: rendered.method,
      url,
      ...(step.itemId ? { itemId: step.itemId } : {}),
    });
    const procCtx = { vars: tempVars, env, logs: [] as string[] };
    await runProcessors(pre, procCtx);
    for (const l of procCtx.logs) await log("info", l);
    Object.assign(vars, tempVars); // 前置写回的临时变量对渲染结果可见（下一步生效）

    if (await isStopped(redis, writer.taskIdValue)) {
      return { status: "STOPPED", message: "任务被停止" };
    }
    // 采样期协作式停止：轮询停止键 → 中断在途请求（EXEC-002 §2）
    const abort = new AbortController();
    const stopWatcher = setInterval(() => {
      void isStopped(redis, writer.taskIdValue).then((stopped) => {
        if (stopped) abort.abort();
      });
    }, 300);
    let result;
    try {
      result = await httpSample(rendered, url, (m) => void log("info", m), {
        hosts: hostsMap(env),
        signal: abort.signal,
      });
    } catch (e) {
      if (abort.signal.aborted && (await isStopped(redis, writer.taskIdValue))) {
        return { status: "STOPPED", message: "任务被停止（在途请求已中断）" };
      }
      throw e;
    } finally {
      clearInterval(stopWatcher);
    }

    const extractResults = runExtractors(extracts, {
      bodyText: result.bodyText,
      headers: result.headers,
    });
    for (const e of extractResults) {
      if (e.scope === "temp") tempVars[e.variable] = e.value;
      else envVarUpdates.push({ name: e.variable, value: e.value });
    }
    const assertInput = {
      status: result.status,
      headers: result.headers,
      bodyText: result.bodyText,
      durationMs: result.durationMs,
      vars: { ...vars, ...tempVars },
    };
    const assertResults = evaluateAsserts(asserts, assertInput);
    for (const a of assertResults) {
      await log(
        a.passed ? "info" : "error",
        `断言 ${a.kind}${a.path ? ` ${a.path}` : ""} ${a.op} ${a.expected} → ${a.passed ? "通过" : `失败（实际 ${a.actual}）`}`,
      );
    }
    await writer.emit({
      type: "step-result",
      ...(step.itemId ? { itemId: step.itemId } : {}),
      status: result.status,
      durationMs: result.durationMs,
      requestSnapshot: {
        method: rendered.method,
        url: result.requestUrl,
        headers: rendered.headers
          .filter((row) => row.enabled)
          .map((row) => ({ key: row.key, value: row.value })),
        body:
          "content" in rendered.body
            ? rendered.body.content
            : `(${rendered.body.kind}${"rows" in rendered.body ? ` ×${rendered.body.rows.length}` : ""})`,
      },
      responseSummary: {
        status: result.status,
        headers: result.headers,
        bodyText: result.bodyText,
        truncated: result.truncated,
      },
      asserts: assertResults,
      extracts: extractResults,
    });

    const postCtx = { vars: tempVars, env, logs: [] as string[] };
    await runProcessors(post, postCtx);
    for (const l of postCtx.logs) await log("info", l);

    const failureKind = classifyFailure(assertResults);
    return {
      status: failureKind ? "FAILED" : "SUCCESS",
      ...(failureKind ? { failureKind } : {}),
      message: failureKind ? `${assertResults.filter((a) => !a.passed).length} 条断言失败` : "",
    };
  } catch (err) {
    if (err instanceof ProcessorError) {
      await log("error", `${err.kind}：${err.message}`);
      return { status: "FAILED", failureKind: err.kind, message: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    await log("error", `网络/配置错误：${message}`);
    return { status: "FAILED", failureKind: "NETWORK_ERROR", message };
  }
}

async function isStopped(redis: Redis, taskId: string): Promise<boolean> {
  return (await redis.exists(execStopKey(taskId))) === 1;
}

/** 任务执行（kernel 流程：指令 → 事件流 → 终态回调）。 */
export async function runTask(redis: Redis, command: unknown): Promise<"success" | "failed" | "stopped"> {
  const cmd = execCommandSchema.parse(command) as ExecCommand;
  const writer = new EventWriter(redis, cmd.taskId);
  const envVarUpdates: { name: string; value: string }[] = [];
  const tempVars: Record<string, string> = {};
  await writer.emit({ type: "task-start" });

  const finish = async (
    outcome: "success" | "failed" | "stopped",
    failureKind?: string,
    message = "",
    stats?: { total: number; passed: number; failed: number },
  ) => {
    await writer.emit({
      type: "task-final",
      outcome,
      ...(failureKind ? { failureKind: failureKind as "NETWORK_ERROR" | "ASSERT_FAILED" | "CONFIG_ERROR" | "SCRIPT_ERROR" } : {}),
      message: message ?? "",
      ...(stats ? { stats } : {}),
    });
    const cb: ExecCallback = {
      outcome,
      ...(failureKind ? { failureKind: failureKind as "NETWORK_ERROR" | "ASSERT_FAILED" | "CONFIG_ERROR" | "SCRIPT_ERROR" } : {}),
      message: message ?? "",
      lastSeq: writer.lastSeq,
      varUpdates: envVarUpdates,
    };
    await postCallback(cmd.taskId, cb);
    return outcome;
  };

  if (cmd.type === "api_debug") {
    await writer.emit({
      type: "log",
      level: "info",
      message: `任务开始 ${cmd.request.method} ${cmd.request.url}`,
    });
    const r = await runStep(redis, writer, cmd.envSnapshot, tempVars, {
      request: cmd.request,
      asserts: cmd.asserts,
      pre: cmd.pre,
      post: cmd.post,
      extracts: cmd.extracts,
    }, envVarUpdates);
    return finish(r.status === "SUCCESS" ? "success" : "failed", r.failureKind, r.message);
  }

  // api_case：串行执行；停止检查在 item 边界与采样前；stopOnFail → 余项 SKIPPED
  let passed = 0;
  let failed = 0;
  let stopped = false;
  let stopOnFail = cmd.stopOnFail;
  for (const item of cmd.items) {
    if (stopped) {
      await writer.emit({ type: "item-final", itemId: item.itemId, status: "SKIPPED", message: "前序失败（失败停止）" });
      continue;
    }
    if (await isStopped(redis, cmd.taskId)) {
      stopped = true;
      await writer.emit({ type: "item-final", itemId: item.itemId, status: "STOPPED", message: "任务被停止" });
      continue;
    }
    await writer.emit({ type: "item-start", itemId: item.itemId, name: item.name });
    const r = await runStep(redis, writer, cmd.envSnapshot, tempVars, {
      itemId: item.itemId,
      name: item.name,
      moduleId: item.moduleId,
      request: item.request,
      asserts: item.asserts,
      pre: item.pre,
      post: item.post,
      extracts: item.extracts,
    }, envVarUpdates);
    if (r.status === "STOPPED") {
      stopped = true; // 余项 SKIPPED（循环顶部处理）
      await writer.emit({
        type: "item-final",
        itemId: item.itemId,
        status: "STOPPED",
        message: r.message,
      });
      continue;
    }
    if (r.status === "SUCCESS") passed += 1;
    else failed += 1;
    await writer.emit({
      type: "item-final",
      itemId: item.itemId,
      status: r.status,
      ...(r.message ? { message: r.message } : { message: "" }),
    });
    if (r.status !== "SUCCESS" && stopOnFail) {
      stopped = true; // 余项 SKIPPED（循环顶部处理）
      stopOnFail = cmd.stopOnFail;
    }
  }
  const stoppedOutcome = stopped && failed === 0;
  const outcome: "success" | "failed" | "stopped" = stoppedOutcome
    ? "stopped"
    : failed > 0
      ? "failed"
      : "success";
  return finish(
    outcome,
    failed > 0 ? "ASSERT_FAILED" : undefined,
    failed > 0 ? `${failed}/${cmd.items.length} 条用例失败` : stopped ? "任务被停止" : "",
    { total: cmd.items.length, passed, failed },
  );
}

/** worker + 注册/心跳 v2（busy 槽位 + 在执任务清单 + 并发动态下发，EXEC-002 §2）。 */
export function startWorker(): void {
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  let inFlight = new Set<string>();
  const worker = new Worker(
    config.execQueueName,
    async (job) => {
      if (job.name !== "exec") return;
      const taskId = String((job.data as { taskId?: string }).taskId ?? job.id ?? "");
      inFlight.add(taskId);
      try {
        await runTask(connection, job.data);
      } finally {
        inFlight.delete(taskId);
      }
    },
    { connection: connection.duplicate(), concurrency: 4 },
  );
  worker.on("failed", (job, err) => {
    console.error(`[engine] job ${job?.id} failed: ${err.message}`);
  });

  let configuredConcurrency = 4;
  const beat = async () => {
    try {
      const res = await fetch(`${config.webUrl}/api/v1/internal/pools/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Token": config.internalToken },
        body: JSON.stringify({
          nodeId: NODE_ID,
          version: VERSION,
          slots: configuredConcurrency,
          busy: inFlight.size,
          taskIds: [...inFlight],
          ts: Date.now(),
        }),
      });
      if (res.ok) {
        const parsed = heartbeatResponseSchema.safeParse((await res.json())?.data);
        if (parsed.success && parsed.data.maxConcurrency !== configuredConcurrency) {
          configuredConcurrency = parsed.data.maxConcurrency;
          worker.concurrency = configuredConcurrency; // BullMQ 运行时并发调整（EXEC-002 §2）
          console.log(`[engine] pool maxConcurrency → ${configuredConcurrency}`);
        }
      } else {
        console.warn(`[engine] heartbeat HTTP ${res.status}`);
      }
    } catch (e) {
      console.warn(`[engine] heartbeat failed: ${e instanceof Error ? e.message : e}`);
    }
  };
  void beat();
  const timer = setInterval(() => void beat(), 10_000);
  const shutdown = async () => {
    clearInterval(timer);
    await worker.close();
    connection.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  console.log(`[engine] worker v${VERSION} started nodeId=${NODE_ID}`);
}
