/**
 * S11 LOAD-003 controller：BullMQ `load` 队列消费（LOAD-002 Phase 1 单 controller）——
 * 调度表展开 → 施压内核逐秒推进 → XADD 秒级帧到 load:stream:{taskId} → 终态回调（loadSummary 载荷）。
 * 停止语义：web SET load:stop:{taskId} → 内核 ≤2s 生效 → 回调 outcome=stopped + 已发总量。
 */
import { Worker } from "bullmq";
import Redis from "ioredis";
import { config, loadQueueNameFor, loadCommandSchema, loadMetricFrameSchema } from "@rabbit/shared";
import { logFor } from "@rabbit/shared/logger";
import { postCallback } from "../callback.js";
import { runLoad, summarize } from "./generator.js";

const queueName = () => loadQueueNameFor(config.enginePoolId);

/** 启动 load controller（engine 进程内与功能 worker 并存）。 */
export function startLoadController(): void {
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const worker = new Worker(
    queueName(),
    async (job) => {
      if (job.name !== "load") return;
      const parsed = loadCommandSchema.safeParse(job.data);
      if (!parsed.success) {
        logFor("engine").warn({ jobId: job.id, err: parsed.error.message }, "load command invalid");
        return;
      }
      const cmd = parsed.data;
      const streamKey = config.loadStreamKey(cmd.taskId);
      const frames = [];
      try {
        const result = await runLoad(cmd, {
          redis: connection,
          onFrame: async (frame) => {
            const valid = loadMetricFrameSchema.parse(frame);
            frames.push(valid);
            await connection.xadd(streamKey, "*", "data", JSON.stringify(valid));
            await connection.expire(streamKey, 60 * 60 * 24);
          },
        });
        const summary = summarize(cmd.thresholds, result.frames);
        await postCallback(cmd.taskId, {
          outcome: result.aborted ? "stopped" : summary.verdict === "SUCCESS" ? "success" : "failed",
          message: result.aborted
            ? `任务被停止（已发压 ${summary.totalSent} 次）`
            : summary.verdict === "SUCCESS"
              ? ""
              : `阈值越限（${summary.items.filter((i) => !i.passed).length}/3 项）`,
          lastSeq: frames.length,
          varUpdates: [],
          // 终态汇总随回调携带（web 回调分支 loadSummarySchema 解析落 Report）
          ...( { loadSummary: summary } as Record<string, unknown>),
        });
      } catch (err) {
        logFor("engine").error({ taskId: cmd.taskId, err }, "load run error");
        await postCallback(cmd.taskId, {
          outcome: "failed",
          failureKind: "CONFIG_ERROR",
          message: err instanceof Error ? err.message : "施压内核异常",
          lastSeq: frames.length,
          varUpdates: [],
        });
      }
    },
    { connection: connection.duplicate(), concurrency: 2 }, // 单节点施压槽位独立（不占功能 4 槽）
  );
  worker.on("failed", (job, err) => {
    logFor("engine").error({ jobId: job?.id, err }, "load job failed");
  });
  const shutdown = async () => {
    await worker.close();
    connection.disconnect();
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  logFor("engine").info({ queue: queueName() }, "load controller started");
}
