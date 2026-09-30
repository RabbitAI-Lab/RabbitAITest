/** EXEC-002/006 runner v4：api_debug 单请求 + api_case 批量（串行）+ scenario 场景（串行/并行）+ plan 计划（S4）。 */
import { config, execCommandSchema, execStopKey, execQueueNameFor } from "@rabbit/shared";
import { logFor } from "@rabbit/shared/logger";
import type { ExecCallback, ExecCommand } from "@rabbit/shared/execution";
import { heartbeatResponseSchema } from "@rabbit/shared/execution";
import { Worker } from "bullmq";
import pLimit from "p-limit";
import Redis from "ioredis";
import { EventWriter } from "../events.js";
import { postCallback } from "../callback.js";
import { runScenarioItem, type ScenarioItemOutcome } from "../kernel/scenario.js";
import { runPlanItem } from "../kernel/plan.js";
import { startProtocolSync } from "../kernel/samplers/registry.js";
import { startDriverSync } from "../kernel/drivers/registry.js";
import { runStep } from "./step.js";
import { runUiCase } from "../uit/runner.js";

const NODE_ID = `node-${process.pid}`;
const VERSION = "0.5.0"; // 契约 v5（+ui_case/ui_batch 命令、ui-screenshot 帧）
/** 池当前并发上限（心跳下发动态更新；parallel 模式 p-limit 取此值） */
let poolConcurrency = 4;

async function isStopped(redis: Redis, taskId: string): Promise<boolean> {
  return (await redis.exists(execStopKey(taskId))) === 1;
}

/** 任务执行（kernel 流程：指令 → 事件流 → 终态回调）。 */
export async function runTask(
  redis: Redis,
  command: unknown,
): Promise<"success" | "failed" | "stopped"> {
  const cmd = execCommandSchema.parse(command) as ExecCommand;
  const writer = new EventWriter(redis, cmd.taskId);
  const envVarUpdates: { name: string; value: string }[] = [];
  const tempVars: Record<string, string> = {};
  const counter = new Map<string, number>(); // __counter 任务作用域（S3 EXEC-003）
  await writer.emit({ type: "task-start" });

  const finish = async (
    outcome: "success" | "failed" | "stopped",
    failureKind?: string,
    message = "",
    stats?: { total: number; passed: number; failed: number; fakeError?: number },
  ) => {
    await writer.emit({
      type: "task-final",
      outcome,
      ...(failureKind
        ? {
            failureKind: failureKind as
              | "NETWORK_ERROR"
              | "ASSERT_FAILED"
              | "CONFIG_ERROR"
              | "SCRIPT_ERROR",
          }
        : {}),
      message: message ?? "",
      ...(stats ? { stats } : {}),
    });
    const cb: ExecCallback = {
      outcome,
      ...(failureKind
        ? {
            failureKind: failureKind as
              | "NETWORK_ERROR"
              | "ASSERT_FAILED"
              | "CONFIG_ERROR"
              | "SCRIPT_ERROR",
          }
        : {}),
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
    const r = await runStep(
      redis,
      writer,
      cmd.envSnapshot,
      tempVars,
      {
        request: cmd.request,
        asserts: cmd.asserts,
        pre: cmd.pre,
        post: cmd.post,
        extracts: cmd.extracts,
        counter,
      },
      envVarUpdates,
    );
    return finish(r.status === "SUCCESS" ? "success" : "failed", r.failureKind, r.message);
  }

  if (cmd.type === "scenario") {
    // 场景批量：serial=顺序（S2 api_case 同构）；parallel=item 级 p-limit（池并发，API-008）
    const itemOutcomes = new Map<string, ScenarioItemOutcome>();
    let stopped = false;
    let stoppedAll = false;
    if (cmd.mode === "serial") {
      for (const item of cmd.items) {
        if (stoppedAll) {
          await writer.emit({
            type: "item-final",
            itemId: item.itemId,
            status: "SKIPPED",
            message: "前序失败（失败停止）",
          });
          continue;
        }
        if (await isStopped(redis, cmd.taskId)) {
          stoppedAll = true;
          await writer.emit({
            type: "item-final",
            itemId: item.itemId,
            status: "STOPPED",
            message: "任务被停止",
          });
          continue;
        }
        // tempVars item 级隔离（变量链不跨场景）；envVarUpdates/counter 任务级共享
        const itemTempVars: Record<string, string> = {};
        const r = await runScenarioItem(
          { redis, writer, env: cmd.envSnapshot, tempVars: itemTempVars, envVarUpdates, counter },
          item,
        );
        itemOutcomes.set(item.itemId, r);
        if (r.status === "STOPPED") {
          stopped = true;
          stoppedAll = true;
        } else if (r.status !== "SUCCESS" && cmd.stopOnFail) {
          stoppedAll = true;
        }
      }
    } else {
      const limit = pLimit(poolConcurrency);
      const jobs = cmd.items.map((item) =>
        limit(async () => {
          if (stoppedAll) {
            await writer.emit({
              type: "item-final",
              itemId: item.itemId,
              status: "SKIPPED",
              message: "失败停止（未开始）",
            });
            return;
          }
          const itemTempVars: Record<string, string> = {};
          const r = await runScenarioItem(
            { redis, writer, env: cmd.envSnapshot, tempVars: itemTempVars, envVarUpdates, counter },
            item,
          );
          itemOutcomes.set(item.itemId, r);
          if (r.status !== "SUCCESS" && cmd.stopOnFail) stoppedAll = true;
        }),
      );
      await Promise.all(jobs);
      if (await isStopped(redis, cmd.taskId)) stopped = true;
    }

    const passed = [...itemOutcomes.values()].filter((r) => r.status === "SUCCESS").length;
    const failed = [...itemOutcomes.values()].filter((r) => r.status === "FAILED").length;
    const outcome: "success" | "failed" | "stopped" =
      stopped && failed === 0 ? "stopped" : failed > 0 ? "failed" : "success";
    return finish(
      outcome,
      failed > 0 ? "ASSERT_FAILED" : undefined,
      failed > 0 ? `${failed}/${cmd.items.length} 个场景失败` : stopped ? "任务被停止" : "",
      { total: cmd.items.length, passed, failed },
    );
  }

  if (cmd.type === "plan") {
    // S4 PLAN-003：计划任务——item 分派（api_case 单步管线 / scenario 内核）；serial/parallel/stopOnFail 与 scenario 分支同构
    const outcomes = new Map<string, { status: string; message: string }>();
    let stopped = false;
    let stoppedAll = false;
    const planDeps = { redis, writer, envVarUpdates, counter };
    const runOne = async (item: (typeof cmd.items)[number]) => {
      const r = await runPlanItem(planDeps, cmd.envSnapshot, item);
      outcomes.set(item.command.itemId, r);
      return r;
    };
    if (cmd.mode === "serial") {
      for (const item of cmd.items) {
        if (stoppedAll) {
          await writer.emit({
            type: "item-final",
            itemId: item.command.itemId,
            status: "SKIPPED",
            message: "前序失败（失败停止）",
          });
          outcomes.set(item.command.itemId, { status: "SKIPPED", message: "前序失败（失败停止）" });
          continue;
        }
        if (await isStopped(redis, cmd.taskId)) {
          stoppedAll = true;
          await writer.emit({
            type: "item-final",
            itemId: item.command.itemId,
            status: "STOPPED",
            message: "任务被停止",
          });
          outcomes.set(item.command.itemId, { status: "STOPPED", message: "任务被停止" });
          continue;
        }
        const r = await runOne(item);
        if (r.status === "STOPPED") {
          stopped = true;
          stoppedAll = true;
        } else if (r.status !== "SUCCESS" && cmd.stopOnFail) {
          stoppedAll = true;
        }
      }
    } else {
      const limit = pLimit(poolConcurrency);
      const jobs = cmd.items.map((item) =>
        limit(async () => {
          if (stoppedAll) {
            await writer.emit({
              type: "item-final",
              itemId: item.command.itemId,
              status: "SKIPPED",
              message: "失败停止（未开始）",
            });
            outcomes.set(item.command.itemId, { status: "SKIPPED", message: "失败停止（未开始）" });
            return;
          }
          const r = await runOne(item);
          if (r.status !== "SUCCESS" && cmd.stopOnFail) stoppedAll = true;
        }),
      );
      await Promise.all(jobs);
      if (await isStopped(redis, cmd.taskId)) stopped = true;
    }
    const passed = [...outcomes.values()].filter((r) => r.status === "SUCCESS").length;
    const failed = [...outcomes.values()].filter((r) => r.status === "FAILED").length;
    const outcome: "success" | "failed" | "stopped" =
      stopped && failed === 0 ? "stopped" : failed > 0 ? "failed" : "success";
    return finish(
      outcome,
      failed > 0 ? "ASSERT_FAILED" : undefined,
      failed > 0 ? `${failed}/${cmd.items.length} 条计划用例失败` : stopped ? "任务被停止" : "",
      { total: cmd.items.length, passed, failed },
    );
  }

  // v5（S11 UIT-002）：ui_case 单用例（playwright-core 驱动；事件帧 step-op + ui-screenshot）
  if (cmd.type === "ui_case") {
    await writer.emit({ type: "item-start", itemId: cmd.itemId, name: cmd.name });
    const r = await runUiCase(
      redis,
      writer,
      {
        taskId: cmd.taskId,
        projectId: cmd.projectId,
        itemId: cmd.itemId,
        name: cmd.name,
        steps: cmd.steps,
        timeoutMs: cmd.timeoutMs,
      },
      () => isStopped(redis, cmd.taskId),
    );
    await writer.emit({
      type: "item-final",
      itemId: cmd.itemId,
      status: r.status === "SUCCESS" ? "SUCCESS" : r.status === "STOPPED" ? "STOPPED" : "FAILED",
      message: r.message,
    });
    return finish(
      r.status === "SUCCESS" ? "success" : r.status === "STOPPED" ? "stopped" : "failed",
      r.failureKind,
      r.message,
      { total: 1, passed: r.status === "SUCCESS" ? 1 : 0, failed: r.status === "FAILED" ? 1 : 0 },
    );
  }

  // v5（S11 UIT-002）：ui_batch 批量（item 串行——chromium 实例开销大，并发留 ENTP 深化；停止检查在 item 边界）
  if (cmd.type === "ui_batch") {
    let uiPassed = 0;
    let uiFailed = 0;
    let uiStopped = false;
    for (const item of cmd.items) {
      if (uiStopped || (await isStopped(redis, cmd.taskId))) {
        uiStopped = true;
        await writer.emit({
          type: "item-final",
          itemId: item.itemId,
          status: "STOPPED",
          message: "任务被停止",
        });
        continue;
      }
      await writer.emit({ type: "item-start", itemId: item.itemId, name: item.name });
      const r = await runUiCase(
        redis,
        writer,
        {
          taskId: cmd.taskId,
          projectId: cmd.projectId,
          itemId: item.itemId,
          name: item.name,
          steps: item.steps,
          timeoutMs: item.timeoutMs,
        },
        () => isStopped(redis, cmd.taskId),
      );
      if (r.status === "SUCCESS") uiPassed += 1;
      else if (r.status === "FAILED") uiFailed += 1;
      else uiStopped = true;
      await writer.emit({
        type: "item-final",
        itemId: item.itemId,
        status: r.status === "SUCCESS" ? "SUCCESS" : r.status === "STOPPED" ? "STOPPED" : "FAILED",
        message: r.message,
      });
      if (r.status !== "SUCCESS" && cmd.stopOnFail) uiStopped = true;
    }
    return finish(
      uiStopped && uiFailed === 0 ? "stopped" : uiFailed > 0 ? "failed" : "success",
      uiFailed > 0 ? "ASSERT_FAILED" : undefined,
      uiFailed > 0 ? `${uiFailed}/${cmd.items.length} 条 UI 用例失败` : uiStopped ? "任务被停止" : "",
      { total: cmd.items.length, passed: uiPassed, failed: uiFailed },
    );
  }

  // api_case：串行执行；停止检查在 item 边界与采样前；stopOnFail → 余项 SKIPPED
  let passed = 0;
  let failed = 0;
  let stopped = false;
  let stopOnFail = cmd.stopOnFail;
  for (const item of cmd.items) {
    if (stopped) {
      await writer.emit({
        type: "item-final",
        itemId: item.itemId,
        status: "SKIPPED",
        message: "前序失败（失败停止）",
      });
      continue;
    }
    if (await isStopped(redis, cmd.taskId)) {
      stopped = true;
      await writer.emit({
        type: "item-final",
        itemId: item.itemId,
        status: "STOPPED",
        message: "任务被停止",
      });
      continue;
    }
    await writer.emit({ type: "item-start", itemId: item.itemId, name: item.name });
    const r = await runStep(
      redis,
      writer,
      cmd.envSnapshot,
      tempVars,
      {
        itemId: item.itemId,
        name: item.name,
        moduleId: item.moduleId,
        request: item.request,
        asserts: item.asserts,
        pre: item.pre,
        post: item.post,
        extracts: item.extracts,
        counter,
      },
      envVarUpdates,
    );
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

/** INFRA-009：进程运行时快照（心跳携带；Node 内建零依赖；导出供单测）。 */
export function procSnapshot(): {
  uptimeSeconds: number;
  cpuSeconds: number;
  rssBytes: number;
  heapUsedBytes: number;
} {
  const cpu = process.cpuUsage();
  const mem = process.memoryUsage();
  const num = (n: number): number => (Number.isFinite(n) && n >= 0 ? n : 0);
  return {
    uptimeSeconds: num(process.uptime()),
    cpuSeconds: num((cpu.user + cpu.system) / 1e6),
    rssBytes: Math.round(num(mem.rss)),
    heapUsedBytes: Math.round(num(mem.heapUsed)),
  };
}

/** worker + 注册/心跳 v2（busy 槽位 + 在执任务清单 + 并发动态下发，EXEC-002 §2；ENTP-006 POOL_ID 池绑定）。 */
export function startWorker(): void {
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  let inFlight = new Set<string>();
  // ENTP-006：engine 进程绑定池（env POOL_ID，缺省默认池=exec 队列，单引擎部署零感知）
  const queueName = execQueueNameFor(config.enginePoolId);
  const worker = new Worker(
    queueName,
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
    logFor("engine").error({ jobId: job?.id, err }, "job failed");
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
          poolId: config.enginePoolId,
          proc: procSnapshot(), // INFRA-009：进程指标随心跳上报（web 摊入 nodes JSON）
        }),
      });
      if (res.ok) {
        const parsed = heartbeatResponseSchema.safeParse((await res.json())?.data);
        if (parsed.success && parsed.data.maxConcurrency !== configuredConcurrency) {
          configuredConcurrency = parsed.data.maxConcurrency;
          poolConcurrency = configuredConcurrency;
          worker.concurrency = configuredConcurrency; // BullMQ 运行时并发调整（EXEC-002 §2）
          logFor("engine").info(
            { maxConcurrency: configuredConcurrency },
            "pool maxConcurrency updated",
          );
        }
      } else {
        logFor("engine").warn({ status: res.status }, "heartbeat http error");
      }
    } catch (e) {
      logFor("engine").warn({ err: e }, "heartbeat failed");
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
  // S6 PLUG-002：协议插件注册表周期同步（30s 轮询 web internal 清单；版本变更才拉包）
  startProtocolSync();
  // PLUG-004：驱动插件注册表同模式同步（SQL 前后置执行面）
  startDriverSync();
  logFor("engine").info(
    { version: VERSION, nodeId: NODE_ID, queue: queueName, poolId: config.enginePoolId },
    "worker started",
  );
}
