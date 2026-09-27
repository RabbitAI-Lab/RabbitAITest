/**
 * Next.js instrumentation（nodejs runtime 专属；API-008 + S6 PLUG-001/SYS-008/API-011/INTG-001）：
 * 1. `schedule` 队列 consumer——场景定时（API-008）+ 平台同步定时（INTG-001）+ Swagger 定时（API-011）+ 审计清理
 * 2. `audit` 落库 consumer（SYS-008 批量直写；生产侧队列不可用时已降级直写）
 * 3. plugin-runner 启动（PLUG-001 勘误 2：dev/e2e 默认 web 进程内嵌——独立 loopback 端口 +
 *    worker_threads 插件隔离不变；生产独立部署时配置 PLUGIN_RUNNER_URL 指向外部进程）
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
    const { runSync } = await import("@/server/domains/api/swagger-sync.service");
    const { pullBugs } = await import("@/server/domains/api/platform-sync.service");
    const { directWrite, purgeExpiredAuditLogs } = await import(
      "@/server/domains/system/audit.service"
    );
    const { prisma } = await import("@rabbit/db");
    const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

    const worker = new Worker(
      "schedule",
      async (job) => {
        const data = job.data as {
          kind?: string;
          scheduleId?: string;
          taskId?: string;
          projectId?: string | null;
        };
        if (job.name === "fire" && data.scheduleId) {
          const r = await fireSchedule(data.scheduleId, data.projectId ?? undefined);
          console.log(`[scheduler] fire ${data.scheduleId} → ${r.taskId ?? r.skipped ?? "noop"}`);
          return;
        }
        if (job.name === "swagger-sync" && data.taskId && data.projectId) {
          const r = await runSync(data.projectId, data.taskId, "system");
          console.log(`[scheduler] swagger-sync ${data.taskId} → ${r.ok ? "ok" : r.error}`);
          return;
        }
        if (job.name === "platform-sync" && data.projectId) {
          const project = await prisma.project.findUnique({
            where: { id: data.projectId },
            select: { orgId: true },
          });
          if (!project) return;
          try {
            const r = await pullBugs(data.projectId, project.orgId, "cron");
            console.log(`[scheduler] platform-sync ${data.projectId} → pulled ${r.pulled} updated ${r.updated}`);
          } catch (e) {
            // 平台故障不抛（历史已留痕；下轮再试——INTG-001 §2 失败语义）
            console.warn(`[scheduler] platform-sync ${data.projectId} failed: ${e instanceof Error ? e.message : e}`);
          }
          return;
        }
        if (job.name === "audit-purge") {
          const row = await prisma.systemParam.findUnique({ where: { key: "audit" } });
          const days = ((row?.value as { auditRetentionDays?: number } | undefined)?.auditRetentionDays) ?? 90;
          const { purged } = await purgeExpiredAuditLogs(days);
          if (purged > 0) console.log(`[audit] purged ${purged} rows (retention=${days}d)`);
        }
      },
      { connection, concurrency: 2 },
    );
    worker.on("failed", (job, err) => {
      console.warn(`[scheduler] job ${job?.id} failed: ${err.message}`);
    });
    console.log("[scheduler] started (queue=schedule: fire/swagger-sync/platform-sync/audit-purge)");

    // 审计落库 consumer（SYS-008）
    const auditWorker = new Worker(
      "audit",
      async (job) => {
        const data = job.data as { events?: Parameters<typeof directWrite>[0] };
        if (data.events?.length) await directWrite(data.events);
      },
      { connection, concurrency: 1 },
    );
    auditWorker.on("failed", (_job, err) => console.warn(`[audit] consumer failed: ${err.message}`));

    // 审计保留清理 repeatable（每日 03:00；jobId 幂等去重）
    const { scheduleQueue } = await import("@/server/redis");
    await scheduleQueue()
      .add("audit-purge", { kind: "audit-purge" }, { repeat: { pattern: "0 3 * * *" }, jobId: "audit-purge-daily" })
      .catch(() => undefined);

    // plugin-runner 内嵌启动
    await startPluginRunner();
  } catch (e) {
    console.warn(`[scheduler] start failed: ${e instanceof Error ? e.message : e}`);
  }
}

async function startPluginRunner(): Promise<void> {
  if (process.env.PLUGIN_RUNNER_URL) return; // 显式配置=外部独立进程，不内嵌
  try {
    const { runnerHealth } = await import("@/server/plugin-runner.client");
    if (await runnerHealth()) return; // 已有实例（dev 双进程场景）
    const runner = await import("@rabbit/plugin-runner");
    runner.startRunner();
  } catch (e) {
    console.warn(`[plugin-runner] embedded start failed: ${e instanceof Error ? e.message : e}`);
  }
}
