/** 环境配置单一来源（rules/git-workflow §5.1.3：地址常量禁多处硬编码）。 */
function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  databaseUrl: env('DATABASE_URL', 'postgresql://localhost:5432/rabbit'),
  redisUrl: env('REDIS_URL', 'redis://127.0.0.1:6379'),
  webUrl: env('WEB_URL', 'http://localhost:3000'),
  sessionSecret: env('SESSION_SECRET', 'dev-only-session-secret-32chars!!'),
  internalToken: env('INTERNAL_TOKEN', 'dev-internal-token'),
  /** 执行事件 Redis Stream（engine 写 / web SSE 读） */
  execStreamKey(taskId: string): string {
    return `exec:stream:${taskId}`;
  },
  execQueueName: 'exec',
  /** 默认资源池 ID（单节点 P0 固定） */
  defaultPoolId: '00000000-0000-0000-0000-000000000001',
} as const;
