/**
 * grpc 协议插件（PLUG-005 §2.5）：@grpc/grpc-js + @grpc/proto-loader（Apache-2.0，Google 官方；npm 官方来源）。
 * 单 run：proto 动态加载 → unary 调用 → 响应。流式登记后续（单 run 探活语义冻结）。
 * proto-loader 0.8 无 fromString——proto 文本写临时文件加载（勘误 2），run 结束清理。
 * configSchema=自写类型守卫（zod 不在插件依赖面）。
 */
import type { SamplerPlugin, SamplerResult, Sampler } from "../../packages/shared/src/plugins/spi";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
// namespace 导入（esbuild CJS bundle 的 default interop 拿不到 proto-loader 的命名导出——
// bundle 内 protoLoader.loadSync=undefined，勘误 7；值与类型同源，禁 const 别名（丢类型命名空间））
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import {
  raceTimeout,
  truncateBody,
  parseHostPort,
} from "../../packages/shared/src/plugins/protocol-kit";

export interface GrpcConfig {
  host: string;
  port?: number;
  protoContent?: string;
  protoBase64?: string;
  service: string;
  method: string;
  requestMessage?: Record<string, unknown>;
  metadata?: Record<string, string>;
  tls: boolean;
  timeoutMs: number;
}

function isGrpcConfig(v: unknown): v is GrpcConfig {
  const c = v as Partial<GrpcConfig>;
  if (typeof c?.host !== "string" || c.host.trim().length === 0 || c.host.length > 256)
    return false;
  if (c.port !== undefined && (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535))
    return false;
  if ((c.protoContent !== undefined) === (c.protoBase64 !== undefined)) return false;
  if (
    c.protoContent !== undefined &&
    (typeof c.protoContent !== "string" || c.protoContent.length > 64 * 1024)
  )
    return false;
  if (
    c.protoBase64 !== undefined &&
    (typeof c.protoBase64 !== "string" || c.protoBase64.length > 128 * 1024)
  )
    return false;
  if (typeof c.service !== "string" || c.service.length === 0 || c.service.length > 256)
    return false;
  if (typeof c.method !== "string" || c.method.length === 0 || c.method.length > 128) return false;
  if (
    c.requestMessage !== undefined &&
    (typeof c.requestMessage !== "object" ||
      c.requestMessage === null ||
      Array.isArray(c.requestMessage))
  )
    return false;
  if (c.metadata !== undefined && (typeof c.metadata !== "object" || c.metadata === null))
    return false;
  if (
    c.timeoutMs !== undefined &&
    (!Number.isInteger(c.timeoutMs) || c.timeoutMs < 100 || c.timeoutMs > 30_000)
  )
    return false;
  return true;
}

export const configSchema = { safeParse: (v: unknown) => ({ success: isGrpcConfig(v) }) };

function grpcCodeToPluginCode(status: number): number {
  if (status === grpc.status.DEADLINE_EXCEEDED) return 1;
  if (status === grpc.status.UNAVAILABLE) return 2;
  if (status === grpc.status.UNAUTHENTICATED || status === grpc.status.PERMISSION_DENIED) return 3;
  return 4;
}

export function createPlugin(): SamplerPlugin {
  return {
    protocol: "grpc",
    configSchema,
    buildSampler(config: unknown): Sampler {
      if (!isGrpcConfig(config)) throw new Error("grpc 配置非法（见 configSchema 守卫）");
      const cfg: GrpcConfig = {
        host: config.host.trim(),
        port: config.port,
        protoContent: config.protoContent,
        protoBase64: config.protoBase64,
        service: config.service,
        method: config.method,
        requestMessage: config.requestMessage ?? {},
        metadata: config.metadata ?? {},
        tls: config.tls ?? false,
        timeoutMs: config.timeoutMs ?? 10_000,
      };
      return {
        run: async (): Promise<SamplerResult> => {
          const started = Date.now();
          const protoText =
            cfg.protoContent ?? Buffer.from(cfg.protoBase64!, "base64").toString("utf8");
          const protoPath = join(tmpdir(), `rabbit-grpc-${randomUUID()}.proto`);
          try {
            writeFileSync(protoPath, protoText);
            let pkgDef: protoLoader.PackageDefinition;
            try {
              pkgDef = protoLoader.loadSync(protoPath, {
                keepCase: true,
                longs: String,
                enums: String,
                defaults: true,
                oneofs: true,
              });
            } catch (e) {
              return {
                ok: false,
                code: 4,
                bodyText: `proto 解析失败：${e instanceof Error ? e.message : String(e)}`,
                responseTimeMs: Date.now() - started,
              };
            }
            const root = grpc.loadPackageDefinition(pkgDef);
            let ctor: unknown;
            const services: string[] = [];
            const walk = (node: unknown, prefix: string): unknown => {
              for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
                const name = prefix ? `${prefix}.${k}` : k;
                if (typeof v === "function" && (v as { service?: unknown }).service) {
                  services.push(name);
                  if (k === cfg.service || name === cfg.service || name.endsWith(`.${cfg.service}`))
                    ctor = v;
                } else if (typeof v === "object" && v !== null) {
                  const hit = walk(v, name);
                  if (hit) return hit;
                }
              }
              return undefined;
            };
            walk(root, "");
            if (!ctor) {
              return {
                ok: false,
                code: 4,
                bodyText: truncateBody(
                  `service 不存在：${cfg.service}（可用：${services.join(", ") || "无"}）`,
                ),
                responseTimeMs: Date.now() - started,
              };
            }
            const { host, port } = parseHostPort(cfg.host, cfg.port, cfg.tls ? 443 : 80);
            const target = `${host}:${port}`;
            const credentials = cfg.tls
              ? grpc.credentials.createSsl()
              : grpc.credentials.createInsecure();
            const client = new (ctor as new (t: string, c: grpc.ChannelCredentials) => grpc.Client)(
              target,
              credentials,
            );
            try {
              const md = new grpc.Metadata();
              for (const [k, v] of Object.entries(cfg.metadata!)) md.add(k, v);
              const reply = await raceTimeout(
                new Promise<unknown>((resolve, reject) => {
                  const fn = (client as unknown as Record<string, (...a: unknown[]) => void>)[
                    cfg.method
                  ];
                  if (!fn) return reject(new Error(`method 不存在：${cfg.method}`));
                  fn.call(
                    client,
                    cfg.requestMessage,
                    md,
                    { deadline: Date.now() + cfg.timeoutMs },
                    (err: grpc.ServiceError | null, response: unknown) => {
                      if (err) reject(err);
                      else resolve(response);
                    },
                  );
                }),
                cfg.timeoutMs + 1000,
                "调用",
              );
              return {
                ok: true,
                code: 0,
                bodyText: truncateBody(JSON.stringify(reply)),
                responseTimeMs: Date.now() - started,
              };
            } catch (e) {
              const se = e as grpc.ServiceError;
              return {
                ok: false,
                code: typeof se?.code === "number" ? grpcCodeToPluginCode(se.code) : 2,
                bodyText: truncateBody(se?.message ?? String(e)),
                responseTimeMs: Date.now() - started,
              };
            } finally {
              client.close();
            }
          } finally {
            rmSync(protoPath, { force: true });
          }
        },
      };
    },
  };
}

export default createPlugin;
