import { ensureCleanupScheduler } from "@/server/jobs/cleanup";

/**
 * 进程级懒初始化（SYS-005 清理 job 等）。
 * 弃用 instrumentation.ts：其 edge 打包会静态解析 bullmq/nodemailer（Node 专有）导致构建失败；
 * 改由守卫热路径触发，registered 标志保证单进程仅注册一次（异步失败不阻塞请求）。
 */
let booted = false;

export function ensureBoot(): void {
  if (booted) return;
  booted = true;
  void ensureCleanupScheduler().catch((err) => {
    console.warn(
      "[boot] 清理 job 注册失败（Redis 不可用等）：",
      err instanceof Error ? err.message : err,
    );
    booted = false; // 允许后续请求重试
  });
}
