/**
 * Next.js instrumentation（nodejs runtime 专属；API-008）：进程内起 `schedule`
 * 队列 consumer——BullMQ repeatable 到点 → fireSchedule → createScenarioTask 入 exec 队列。
 * 单实例口径（社区版单机部署；多实例需分布式锁，API-008 §1.4 登记）。
 * 注：本项目存在 edge middleware，instrumentation.ts 会被双 runtime 编译——pg 依赖链
 * 必须隔离在本 nodejs-only 文件（Next 15.3+ 约定），否则 edge bundle 解析 fs/pg 失败。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DISABLE_SCHEDULER === "1") return; // e2e/CI 侧按需关闭
  try {
    const { Worker } = await import("bullmq");
    const Redis = (await import("ioredis")).default;
    const { config } = await import("@rabbit/shared");
    const { fireSchedule } = await import("@/server/domains/api/schedule.service");
    const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
    const worker = new Worker(
      "schedule",
      async (job) => {
        if (job.name !== "fire") return;
        const data = job.data as { scheduleId?: string; projectId?: string | null };
        if (!data.scheduleId) return;
        const r = await fireSchedule(data.scheduleId, data.projectId ?? undefined);
        console.log(`[scheduler] fire ${data.scheduleId} → ${r.taskId ?? r.skipped ?? "noop"}`);
      },
      { connection, concurrency: 2 },
    );
    worker.on("failed", (job, err) => {
      console.warn(`[scheduler] job ${job?.id} failed: ${err.message}`);
    });
    console.log("[scheduler] started (queue=schedule)");
  } catch (e) {
    console.warn(`[scheduler] start failed: ${e instanceof Error ? e.message : e}`);
  }
}
