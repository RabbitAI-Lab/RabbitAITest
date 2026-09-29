/**
 * mongodb 协议插件（PLUG-005 §2.4）：mongodb 官方 Node 驱动（Apache-2.0；npm 官方来源）。
 * 单 run：connect → ping/count/find(只读, limit≤100) → close。只读三操作；$where 拒绝（server-side JS）。
 * CI 无 mongod——真连路径豁免登记（mongodb-memory-server 70MB 二进制供应链不可接受）。
 * configSchema=自写类型守卫（zod 不在插件依赖面）。
 */
import type { SamplerPlugin, SamplerResult, Sampler } from "../../packages/shared/src/plugins/spi";
import { MongoClient } from "mongodb";
import { raceTimeout, truncateBody } from "../../packages/shared/src/plugins/protocol-kit";

export interface MongoConfig {
  uri: string;
  operation: "ping" | "count" | "find";
  collection?: string;
  query?: Record<string, unknown>;
  limit?: number;
  timeoutMs?: number;
}

function validUri(uri: unknown): uri is string {
  return typeof uri === "string" && (uri.startsWith("mongodb://") || uri.startsWith("mongodb+srv://"));
}

function rejectsServerSideJs(q: Record<string, unknown>): boolean {
  return JSON.stringify(q).includes('"$where"');
}

function isMongoConfig(v: unknown): v is MongoConfig {
  const c = v as Partial<MongoConfig>;
  if (!validUri(c?.uri)) return false;
  const op = c.operation ?? "ping";
  if (!["ping", "count", "find"].includes(op)) return false;
  if (op !== "ping" && (typeof c.collection !== "string" || c.collection.length === 0)) return false;
  if (c.query !== undefined && (typeof c.query !== "object" || c.query === null || Array.isArray(c.query)))
    return false;
  if (c.query !== undefined && rejectsServerSideJs(c.query)) return false;
  if (c.limit !== undefined && (!Number.isInteger(c.limit) || c.limit < 1 || c.limit > 100)) return false;
  if (
    c.timeoutMs !== undefined &&
    (!Number.isInteger(c.timeoutMs) || c.timeoutMs < 100 || c.timeoutMs > 30_000)
  )
    return false;
  return true;
}

export const configSchema = { safeParse: (v: unknown) => ({ success: isMongoConfig(v) }) };

function dbNameFromUri(uri: string): string | null {
  const idx = uri.indexOf("/", uri.indexOf("//") + 2);
  if (idx === -1) return null;
  const path = uri.slice(idx + 1).split("?")[0];
  return path ? decodeURIComponent(path) : null;
}

export function createPlugin(): SamplerPlugin {
  return {
    protocol: "mongodb",
    configSchema,
    buildSampler(config: unknown) {
      if (!isMongoConfig(config)) throw new Error("mongodb 配置非法");
      const cfg = config;
      const op = cfg.operation ?? "ping";
      const timeoutMs = cfg.timeoutMs ?? 10_000;
      return {
        run: async (): Promise<SamplerResult> => {
          const started = Date.now();
          const client = new MongoClient(cfg.uri, { serverSelectionTimeoutMS: timeoutMs });
          try {
            await raceTimeout(client.connect(), timeoutMs, "连接");
            if (op === "ping") {
              await client.db().admin().listDatabases();
              return { ok: true, code: 0, bodyText: "pong", responseTimeMs: Date.now() - started };
            }
            const dbName = dbNameFromUri(cfg.uri);
            if (!dbName) {
              return {
                ok: false,
                code: 4,
                bodyText: "count/find 须 uri 带库名（mongodb://host:port/db）",
                responseTimeMs: Date.now() - started,
              };
            }
            const coll = client.db(dbName).collection(cfg.collection!);
            if (op === "count") {
              const n = await coll.estimatedDocumentCount();
              return {
                ok: true,
                code: 0,
                bodyText: `count=${n}`,
                responseTimeMs: Date.now() - started,
              };
            }
            const docs = await coll
              .find(cfg.query ?? {})
              .limit(cfg.limit ?? 10)
              .toArray();
            return {
              ok: true,
              code: 0,
              bodyText: truncateBody(JSON.stringify(docs)),
              responseTimeMs: Date.now() - started,
            };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return {
              ok: false,
              code: /超时|timed out/i.test(msg) ? 1 : /authentication|SCRAM/i.test(msg) ? 3 : 2,
              bodyText: truncateBody(msg),
              responseTimeMs: Date.now() - started,
            };
          } finally {
            await client.close().catch(() => undefined);
          }
        },
      };
    },
  };
}

export default createPlugin;
