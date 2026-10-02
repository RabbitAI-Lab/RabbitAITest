/**
 * redis 协议插件（PLUG-005 §2.3）：ioredis（MIT，npm 官方来源）。
 * 单 run：connect → call 单命令 → quit。RESP 协议按参数分帧，值不拼进命令文本（与绑定参数同构）。
 * 危险命令黑名单（首 token 词法拦截）：FLUSHALL/FLUSHDB/CONFIG/SHUTDOWN/DEBUG/MONITOR/REPLICAOF/FAILOVER/SCRIPT/EVAL/EVALSHA。
 * configSchema=自写类型守卫（tcp-conn 先例，zod 不在插件依赖面——构建期零解析）。
 */
import type { SamplerPlugin, SamplerResult, Sampler } from "../../packages/shared/src/plugins/spi";
import Redis from "ioredis";
import { raceTimeout, truncateBody } from "../../packages/shared/src/plugins/protocol-kit";

const BLOCKED_COMMANDS = new Set([
  "FLUSHALL",
  "FLUSHDB",
  "CONFIG",
  "SHUTDOWN",
  "DEBUG",
  "MONITOR",
  "REPLICAOF",
  "FAILOVER",
  "SCRIPT",
  "EVAL",
  "EVALSHA",
]);

export interface RedisConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  command: string;
  args: string[];
  timeoutMs: number;
}

function firstError(v: unknown): string | null {
  const c = v as Partial<RedisConfig>;
  if (typeof c?.command !== "string" || c.command.trim().length === 0 || c.command.length > 64)
    return "command 必填（≤64 字符）";
  if (c.url !== undefined && (typeof c.url !== "string" || !c.url.startsWith("redis://")))
    return "url 须以 redis:// 开头";
  if (c.url === undefined && (typeof c.host !== "string" || typeof c.port !== "number"))
    return "url 与 host+port 二选一必填";
  if (c.port !== undefined && (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535))
    return "port 须为 1-65535 整数";
  if (c.db !== undefined && (!Number.isInteger(c.db) || c.db < 0 || c.db > 15))
    return "db 须为 0-15 整数";
  if (
    c.args !== undefined &&
    (!Array.isArray(c.args) ||
      c.args.length > 32 ||
      c.args.some((a) => typeof a !== "string" || a.length > 8192))
  )
    return "args 须为字符串数组（≤32 项，单项 ≤8KB）";
  if (
    c.timeoutMs !== undefined &&
    (!Number.isInteger(c.timeoutMs) || c.timeoutMs < 100 || c.timeoutMs > 30_000)
  )
    return "timeoutMs 须为 100-30000 整数";
  return null;
}

function normalize(v: unknown): RedisConfig | null {
  if (firstError(v)) return null;
  const c = v as RedisConfig;
  return {
    url: c.url,
    host: c.host,
    port: c.port,
    password: c.password,
    db: c.db,
    command: c.command.trim(),
    args: c.args ?? [],
    timeoutMs: c.timeoutMs ?? 10_000,
  };
}

export const configSchema = { safeParse: (v: unknown) => ({ success: normalize(v) !== null }) };

function buildSampler(config: unknown): Sampler {
  const err = firstError(config);
  if (err) throw new Error(`redis 配置非法：${err}`);
  const cfg = normalize(config)!;
  return {
    run: async (): Promise<SamplerResult> => {
      const started = Date.now();
      const cmd = cfg.command.toUpperCase();
      if (BLOCKED_COMMANDS.has(cmd)) {
        return {
          ok: false,
          code: 4,
          bodyText: `危险命令被拒绝：${cmd}（安全黑名单——FLUSHALL/CONFIG/EVAL 等）`,
          responseTimeMs: Date.now() - started,
        };
      }
      let client: Redis;
      try {
        if (cfg.url) {
          client = new Redis(cfg.url, {
            connectTimeout: cfg.timeoutMs,
            maxRetriesPerRequest: 0,
            lazyConnect: true,
          });
        } else {
          client = new Redis({
            host: cfg.host!,
            port: cfg.port!,
            password: cfg.password,
            db: cfg.db ?? 0,
            connectTimeout: cfg.timeoutMs,
            maxRetriesPerRequest: 0,
            lazyConnect: true,
          });
        }
      } catch (e) {
        return {
          ok: false,
          code: 2,
          bodyText: e instanceof Error ? e.message : String(e),
          responseTimeMs: Date.now() - started,
        };
      }
      try {
        await raceTimeout(client.connect(), cfg.timeoutMs, "连接");
        const reply = await raceTimeout(
          client.call(cmd, ...cfg.args) as Promise<unknown>,
          cfg.timeoutMs,
          "命令",
        );
        await client.quit().catch(() => undefined);
        const text = typeof reply === "string" ? reply : JSON.stringify(reply);
        return {
          ok: true,
          code: 0,
          bodyText: truncateBody(text ?? "OK"),
          responseTimeMs: Date.now() - started,
        };
      } catch (e) {
        client.disconnect();
        const msg = e instanceof Error ? e.message : String(e);
        return {
          ok: false,
          code: /超时/.test(msg) ? 1 : /WRONGPASS|NOAUTH|authentication/i.test(msg) ? 3 : 2,
          bodyText: truncateBody(msg),
          responseTimeMs: Date.now() - started,
        };
      }
    },
  };
}

export function createPlugin(): SamplerPlugin {
  return { protocol: "redis", configSchema, buildSampler };
}

export default createPlugin;
