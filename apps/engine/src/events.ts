import type Redis from "ioredis";
import { config, eventFrameSchema } from "@rabbit/shared";
import type { EventFrame, FrameInput } from "@rabbit/shared";

/** 事件流写入器：seq 任务内单调递增；XADD 到 Redis Stream（与 SSE/报告同源）。 */
export class EventWriter {
  private seq = 0;
  private readonly streamKey: string;

  constructor(
    private readonly redis: Redis,
    private readonly taskId: string,
  ) {
    this.streamKey = config.execStreamKey(taskId);
  }

  get lastSeq(): number {
    return this.seq;
  }

  async emit(frame: FrameInput & { ts?: number }): Promise<void> {
    this.seq += 1;
    const full = eventFrameSchema.parse({
      ...frame,
      taskId: this.taskId,
      seq: this.seq,
      ts: frame.ts ?? Date.now(),
    }) as EventFrame;
    await this.redis.xadd(this.streamKey, "*", "data", JSON.stringify(full));
    await this.redis.expire(this.streamKey, 60 * 60 * 24);
  }
}
