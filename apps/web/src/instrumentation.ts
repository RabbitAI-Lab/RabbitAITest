/**
 * Next.js instrumentation 入口：nodejs runtime 下动态导入 node 专属逻辑
 * （BullMQ/pg/runner 依赖链隔离在 instrumentation-node.ts）。
 * 勘误（S6 发现）：原实现仅注释指引「见 instrumentation-node.ts」而未导入——
 * 该文件自 S3 起从未被执行（schedule 消费者缺位，定时 e2e 靠手动触发端点掩盖）；
 * 现按官方模式按 runtime 分流，worker 消费链路（fire/swagger-sync/platform-sync/audit/audit-purge）真正生效。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const node = await import("./instrumentation-node");
    await node.register();
  }
}
