/** Next.js instrumentation：服务进程启动钩子（SYS-005 清理 job 注册等）。 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { ensureCleanupScheduler } = await import('@/server/jobs/cleanup');
  await ensureCleanupScheduler();
}
