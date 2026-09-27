/**
 * Next.js instrumentation（edge runtime 安全壳）：实际逻辑在 `instrumentation-node.ts`
 * （nodejs-only，Next 15.3+ 约定）——本项目存在 edge middleware，本文件会被编译进
 * edge bundle，禁止引用任何 Node 专属依赖（pg/fs 链会在 edge 解析失败）。
 */
export async function register(): Promise<void> {
  // 定时任务 consumer 等 Node 逻辑见 instrumentation-node.ts
}
