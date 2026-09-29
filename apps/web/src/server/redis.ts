import Redis from "ioredis";
import { Queue } from "bullmq";
import { config, execQueueNameFor } from "@rabbit/shared";

const globalForInfra = globalThis as unknown as {
  __redis?: Redis;
  __execQueue?: Queue;
  __execQueuesByPool?: Map<string, Queue>;
  __scheduleQueue?: Queue;
};

export function redis(): Redis {
  if (!globalForInfra.__redis) {
    globalForInfra.__redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
      enableAutoPipelining: true,
    });
  }
  return globalForInfra.__redis;
}

/** 执行任务入队（web 编排 → engine 消费）。 */
export function execQueue(): Queue {
  if (!globalForInfra.__execQueue) {
    globalForInfra.__execQueue = new Queue(config.execQueueName, {
      connection: new Redis(config.redisUrl, { maxRetriesPerRequest: null }),
    });
  }
  return globalForInfra.__execQueue;
}

/** 按池入队（S9 ENTP-006）：非默认池任务入 `exec:{poolId}` 隔离队列；默认池沿用 `exec`（零回归）。 */
export function execQueueFor(poolId?: string | null): Queue {
  const name = execQueueNameFor(poolId);
  if (name === config.execQueueName) return execQueue();
  if (!globalForInfra.__execQueuesByPool) globalForInfra.__execQueuesByPool = new Map();
  let q = globalForInfra.__execQueuesByPool.get(name);
  if (!q) {
    q = new Queue(name, { connection: new Redis(config.redisUrl, { maxRetriesPerRequest: null }) });
    globalForInfra.__execQueuesByPool.set(name, q);
  }
  return q;
}

/** 定时任务队列（web 自产自销：repeatable 触发 → instrumentation 内 consumer 建场景任务，API-008）。 */
export function scheduleQueue(): Queue {
  if (!globalForInfra.__scheduleQueue) {
    globalForInfra.__scheduleQueue = new Queue("schedule", {
      connection: new Redis(config.redisUrl, { maxRetriesPerRequest: null }),
    });
  }
  return globalForInfra.__scheduleQueue;
}
