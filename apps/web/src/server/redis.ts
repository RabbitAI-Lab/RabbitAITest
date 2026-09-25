import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { config } from '@rabbit/shared';

const globalForInfra = globalThis as unknown as {
  __redis?: Redis;
  __execQueue?: Queue;
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
