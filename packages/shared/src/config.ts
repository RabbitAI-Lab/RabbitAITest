/** 环境配置单一来源（rules/git-workflow §5.1.3：地址常量禁多处硬编码）。 */
import { execStopKey } from "./execution/schemas";

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  databaseUrl: env("DATABASE_URL", "postgresql://localhost:5432/rabbit"),
  redisUrl: env("REDIS_URL", "redis://127.0.0.1:6379"),
  webUrl: env("WEB_URL", "http://localhost:3000"),
  sessionSecret: env("SESSION_SECRET", "dev-only-session-secret-32chars!!"),
  internalToken: env("INTERNAL_TOKEN", "dev-internal-token"),
  /** 社区版用户上限（SYS-004；测试环境经 RABBIT_USER_LIMIT 放宽，产品默认 30 不变） */
  userLimit: Number(env("RABBIT_USER_LIMIT", "30")),
  /** License 签发/验签密钥（S9 ENTP-007；生产必换，开发缺省仅供本地签发与测试） */
  licenseSigningSecret: env("LICENSE_SIGNING_SECRET", "rabbit-dev-license-secret"),
  /** 执行事件 Redis Stream（engine 写 / web SSE 读） */
  execStreamKey(taskId: string): string {
    return `exec:stream:${taskId}`;
  },
  /** 任务停止控制键（web 写 / engine 轮询，EXEC-002 §2；同源 execution/schemas） */
  execStopKey,
  execQueueName: "exec",
  /** 默认资源池 ID（单节点 P0 固定） */
  defaultPoolId: "00000000-0000-0000-0000-000000000001",
  /**
   * 本引擎进程绑定的资源池 ID（S9 ENTP-006）：未设置=默认池（现状行为不变）。
   * engine 与 web 同源引用 execQueueNameFor，防队列名漂移。
   */
  enginePoolId: env("POOL_ID", "00000000-0000-0000-0000-000000000001"),
} as const;

/**
 * 按池队列名（S9 ENTP-006）：非默认池任务入 `exec-pool-{poolId}` 隔离队列
 * （勘误 1：BullMQ 队列名禁含冒号——设计稿 `exec:{poolId}` 改连字符），
 * 默认池（含未传 poolId）恒入 `exec`——单引擎部署零感知零回归。
 */
export function execQueueNameFor(poolId?: string | null): string {
  return poolId && poolId !== config.defaultPoolId ? `exec-pool-${poolId}` : config.execQueueName;
}
