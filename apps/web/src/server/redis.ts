import Redis from "ioredis";
import { Queue } from "bullmq";
import { config } from "@rabbit/shared";

const globalForInfra = globalThis as unknown as {
  __redis?: Redis;
  __execQueue?: Queue;
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

/** 定时任务队列（web 自产自销：repeatable 触发 → instrumentation 内 consumer 建场景任务，API-008）。 */
export function scheduleQueue(): Queue {
  if (!globalForInfra.__scheduleQueue) {
    globalForInfra.__scheduleQueue = new Queue("schedule", {
      connection: new Redis(config.redisUrl, { maxRetriesPerRequest: null }),
    });
  }
  return globalForInfra.__scheduleQueue;
}

