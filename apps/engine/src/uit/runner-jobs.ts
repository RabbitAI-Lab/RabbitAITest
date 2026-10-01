/**
 * S14 UIT-004：runner 管理作业消费（BullMQ 队列 config.runnerQueueName，与 exec 队列隔离——
 * 不占执行槽位、不参与心跳并发记账）。install/check/remove 三类（runnerJobSchema 白名单解析），
 * 结果经 internal/runners/report 回调 web（X-Internal-Token；引擎无 DB 纪律）。
 * 失败兜底：job 异常不抛出（BullMQ 重试无意义——安装失败由用户显式重试），回调失败仅日志留痕。
 */
import { Worker } from "bullmq";
import Redis from "ioredis";
import { config, runnerJobSchema, runnerReportSchema } from "@rabbit/shared";
import type { RunnerReport } from "@rabbit/shared";
import { logFor } from "@rabbit/shared/logger";
import {
  checkRunnerEnv,
  installProjectRunner,
  removeRunnerDir,
  resolveRunner,
} from "./runner-env.js";

const log = logFor("engine");

async function report(payload: RunnerReport): Promise<void> {
  try {
    const res = await fetch(`${config.webUrl}/api/v1/internal/runners/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": config.internalToken },
      body: JSON.stringify(runnerReportSchema.parse(payload)),
    });
    if (!res.ok) log.warn({ status: res.status, kind: payload.kind }, "runner report rejected");
  } catch (e) {
    log.warn({ err: e, kind: payload.kind }, "runner report failed");
  }
}

async function handleJob(data: unknown): Promise<void> {
  const parsed = runnerJobSchema.safeParse(data);
  if (!parsed.success) {
    log.warn({ issues: parsed.error.issues.length }, "runner job payload invalid");
    return;
  }
  const job = parsed.data;
  try {
    if (job.kind === "install") {
      const result = await installProjectRunner(job, (stage, logTail) => {
        void report({
          kind: "progress",
          runnerId: job.runnerId,
          projectId: job.projectId,
          stage,
          logTail,
        });
      });
      await report({
        kind: "install",
        runnerId: job.runnerId,
        projectId: job.projectId,
        status: result.status,
        installLogTail: result.installLogTail,
        check: result.check,
      });
      return;
    }
    if (job.kind === "check") {
      const runner =
        job.target === "project" && job.runnerId
          ? await resolveRunner(job.projectId, job.runnerId)
          : await resolveRunner(job.projectId, null);
      try {
        const check = await checkRunnerEnv(runner, { installContext: true });
        await report({
          kind: "check",
          projectId: job.projectId,
          target: job.target,
          runnerId: job.runnerId,
          check,
        });
      } catch (e) {
        // 目录缺失等解析失败：产出 runner_pkg fail 项清单（web 端可据此渲染，不静默）
        await report({
          kind: "check",
          projectId: job.projectId,
          target: job.target,
          runnerId: job.runnerId,
          check: {
            items: [
              {
                key: "runner_pkg",
                label: "runner 包",
                status: "fail",
                detail: (e as Error).message.slice(0, 512),
                hint: "重新安装该 Runner",
              },
            ],
            checkedAt: new Date().toISOString(),
          },
        });
      }
      return;
    }
    // remove
    const ok = await removeRunnerDir(job.projectId, job.runnerId);
    await report({
      kind: "remove",
      runnerId: job.runnerId,
      projectId: job.projectId,
      ok,
      message: ok ? "" : "目录清理失败（详见引擎日志）",
    });
  } catch (e) {
    log.error({ err: e, kind: job.kind }, "runner job failed");
    if (job.kind === "install") {
      await report({
        kind: "install",
        runnerId: job.runnerId,
        projectId: job.projectId,
        status: "FAILED",
        installLogTail: (e as Error).message.slice(0, 2000),
        check: null,
      });
    }
  }
}

export function startRunnerWorker(): void {
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const worker = new Worker(config.runnerQueueName, async (job) => handleJob(job.data), {
    connection: connection.duplicate(),
    concurrency: 2,
  });
  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err }, "runner job worker failed");
  });
  log.info({ queue: config.runnerQueueName }, "runner worker started");
}
