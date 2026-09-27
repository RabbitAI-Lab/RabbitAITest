/**
 * 固定窗口限流（INTG-003 §2）：Redis INCR+EXPIRE；每 key 默认 10 次/秒（open API 面）。
 * Redis 不可用降级放行（限流是防滥用层，不作为安全边界——认证与越权校验在前）。
 */
import { redis } from "./redis";

export async function rateLimit(
  bucket: string,
  identity: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const key = `rl:${bucket}:${identity}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
  try {
    const client = redis();
    const n = await client.incr(key);
    if (n === 1) await client.pexpire(key, windowSeconds * 1000 + 50);
    return { allowed: n <= limit, remaining: Math.max(0, limit - n) };
  } catch {
    return { allowed: true, remaining: limit };
  }
}
