import { config, execCommandSchema } from "@rabbit/shared";
import type { ExecCommand } from "@rabbit/shared";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { EventWriter } from "../events.js";
import { postCallback } from "../callback.js";
import { evaluateAsserts, classifyFailure } from "../kernel/asserts.js";
import { httpSample } from "../samplers/http.js";

const NODE_ID = `node-${process.pid}`;
const VERSION = "0.1.0";

/** 任务执行（kernel 流程：指令 → 事件流 → 终态回调）。 */
export async function runTask(redis: Redis, command: unknown): Promise<"success" | "failed"> {
  const cmd = execCommandSchema.parse(command) as ExecCommand;
  const writer = new EventWriter(redis, cmd.taskId);
  await writer.emit({ type: "task-start" });
  await writer.emit({
    type: "log",
    level: "info",
    message: `任务开始 ${cmd.request.method} ${cmd.request.url}`,
  });
  await writer.emit({ type: "step-start", method: cmd.request.method, url: cmd.request.url });
  try {
    const logs: string[] = [];
    const result = await httpSample(cmd.request, (m) => logs.push(m));
    for (const l of logs) await writer.emit({ type: "log", level: "info", message: l });
    const asserts = evaluateAsserts(cmd.asserts, {
      status: result.status,
      bodyText: result.bodyText,
    });
    for (const a of asserts) {
      await writer.emit({
        type: "log",
        level: a.passed ? "info" : "error",
        message: `断言 ${a.kind}${a.path ? ` ${a.path}` : ""} ${a.op === "eq" ? "=" : "⊇"} ${a.expected} → ${a.passed ? "通过" : `失败（实际 ${a.actual}）`}`,
      });
    }
    await writer.emit({
      type: "step-result",
      status: result.status,
      durationMs: result.durationMs,
      requestSnapshot: {
        method: cmd.request.method,
        url: cmd.request.url,
        headers: cmd.request.headers,
        body: cmd.request.body.content,
      },
      responseSummary: {
        status: result.status,
        headers: result.headers,
        bodyText: result.bodyText,
        truncated: result.truncated,
      },
      asserts,
    });
    const failureKind = classifyFailure(asserts);
    const outcome = failureKind ? "failed" : "success";
    await writer.emit({
      type: "task-final",
      outcome,
      ...(failureKind ? { failureKind } : {}),
      message: failureKind ? `${asserts.filter((a) => !a.passed).length} 条断言失败` : "",
    });
    await postCallback(cmd.taskId, {
      outcome,
      failureKind: failureKind ?? undefined,
      message: failureKind ? "ASSERT_FAILED" : "",
      lastSeq: writer.lastSeq,
    });
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writer.emit({ type: "log", level: "error", message: `网络/配置错误：${message}` });
    await writer.emit({
      type: "task-final",
      outcome: "failed",
      failureKind: "NETWORK_ERROR",
      message,
    });
    await postCallback(cmd.taskId, {
      outcome: "failed",
      failureKind: "NETWORK_ERROR",
      message,
      lastSeq: writer.lastSeq,
    });
    return "failed";
  }
}

/** worker + 注册/心跳（EXEC-001 §4）。 */
export function startWorker(): void {
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const worker = new Worker(
    config.execQueueName,
    async (job) => {
      if (job.name !== "exec") return;
      await runTask(connection, job.data);
    },
    { connection: connection.duplicate(), concurrency: 4 },
  );
  worker.on("failed", (job, err) => {
    console.error(`[engine] job ${job?.id} failed: ${err.message}`);
  });

  const beat = async () => {
    try {
      const res = await fetch(`${config.webUrl}/api/v1/internal/pools/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Token": config.internalToken },
        body: JSON.stringify({ nodeId: NODE_ID, version: VERSION, slots: 4, ts: Date.now() }),
      });
      if (!res.ok) console.warn(`[engine] heartbeat HTTP ${res.status}`);
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
  console.log(`[engine] worker started nodeId=${NODE_ID} version=${VERSION}`);
}
