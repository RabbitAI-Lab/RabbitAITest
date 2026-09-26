/**
 * SYS-005 数据清理 job：BullMQ repeatable（每日 03:00 系统时区）。
 * 删除超期 ChangeLog/AuditLog，按 5000 条分批；清理计数写回 cleanup 参数与结构化日志。
 */
import { Queue, Worker } from "bullmq";
import { config } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { readParam, updateParam } from "@/server/domains/system/param.service";

export const CLEANUP_QUEUE = "cleanup";
const BATCH = 5000;

/** 清理一轮（单测直接覆盖此纯逻辑入口）。 */
export async function runCleanupOnce(
  now = new Date(),
): Promise<{ changes: number; audits: number; purgedProjects: number }> {
  const cleanup = await readParam("cleanup");
  const logDays = Number(cleanup.logRetentionDays) || 90;
  const changeDays = Number(cleanup.changeLogRetentionDays) || 90;
  let changes = 0;
  let audits = 0;
  // ChangeLog：按 (entityType, entityId, createdAt) 超期删除，分批
  for (;;) {
    const batch = await prisma.changeLog.findMany({
      where: { createdAt: { lt: new Date(now.getTime() - changeDays * 86400_000) } },
      select: { id: true },
      take: BATCH,
    });
    if (batch.length === 0) break;
    const r = await prisma.changeLog.deleteMany({ where: { id: { in: batch.map((b) => b.id) } } });
    changes += r.count;
    if (batch.length < BATCH) break;
  }
  for (;;) {
    const batch = await prisma.auditLog.findMany({
      where: { createdAt: { lt: new Date(now.getTime() - logDays * 86400_000) } },
      select: { id: true },
      take: BATCH,
    });
    if (batch.length === 0) break;
    const r = await prisma.auditLog.deleteMany({ where: { id: { in: batch.map((b) => b.id) } } });
    audits += r.count;
    if (batch.length < BATCH) break;
  }
  // 超期软删项目物理删除（PROJ-001：30 天可撤销窗口）
  let purgedProjects = 0;
  const due = await prisma.project.findMany({
    where: { purgeAt: { lt: now } },
    select: { id: true },
  });
  for (const p of due) {
    try {
      const { purgeProject } = await import("@/server/domains/project/project.service");
      await purgeProject(p.id);
      purgedProjects += 1;
    } catch (err) {
      console.warn("[cleanup] purge project failed", p.id, err);
    }
  }
  const prev = await readParam("cleanup");
  await updateParam("cleanup", {
    logRetentionDays: logDays,
    changeLogRetentionDays: changeDays,
    lastRunAt: now.toISOString(),
    lastRunCount: changes + audits,
  }).catch(() => undefined);
  void prev;
  console.log(JSON.stringify({ msg: "cleanup done", changes, audits, at: now.toISOString() }));
  return { changes, audits, purgedProjects };
}

let registered = false;

/** web 进程启动时注册（instrumentation.ts 调用；Redis 不可用时降级跳过，不阻塞服务）。 */
export async function ensureCleanupScheduler(): Promise<void> {
  if (registered) return;
  registered = true;
  try {
    const queue = new Queue(CLEANUP_QUEUE, { connection: { url: config.redisUrl } });
    await queue.add(
      "daily",
      {},
      {
        repeat: { pattern: "0 3 * * *" },
        jobId: "cleanup-daily",
      },
    );
    new Worker(CLEANUP_QUEUE, async () => runCleanupOnce(), {
      connection: { url: config.redisUrl },
      concurrency: 1,
    });
    console.log("[cleanup] scheduler ready (daily 03:00)");
  } catch (err) {
    console.warn(
      "[cleanup] Redis 不可用，定时清理未注册：",
      err instanceof Error ? err.message : err,
    );
  }
}
