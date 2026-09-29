/**
 * ssh 协议插件（PLUG-005 §2.2）：ssh2（MIT，Microsoft VS Code Remote 同款；npm 官方来源）。
 * 单 run：connect → exec 单命令 → 收 stdout+stderr → close。
 *
 * 安全边界（规格 §2.2 诚实登记）：本插件是「SSH 远程命令执行」的测试工具——
 * command 字段是测试人员对被测 SSH 服务器的有意指令（与 SQL 处理器「测试人员自写语句」
 * 同构的产品语义）；本仓代码不做任何本机 shell 调用，command 经 ssh2 纯 SSH 协议客户端
 * 以加密信道发送至远端执行。命令无法词法白名单（shell 语义过宽，假防护比无防护更糟），
 * 目标与命令摘要入审计日志（不含凭据），凭据不落库。
 * configSchema=自写类型守卫（tcp-conn 先例，zod 不在插件依赖面）。
 */
import type { SamplerPlugin, SamplerResult, Sampler } from "../../packages/shared/src/plugins/spi";
import { Client as SshClient } from "ssh2";
import { truncateBody, parseHostPort } from "../../packages/shared/src/plugins/protocol-kit";

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  authType: "password" | "privateKey";
  password?: string;
  privateKey?: string;
  command: string;
  timeoutMs: number;
}

function firstError(v: unknown): string | null {
  const c = v as Partial<SshConfig>;
  if (typeof c?.host !== "string" || c.host.trim().length === 0 || c.host.length > 256) return "host 必填";
  if (c.port !== undefined && (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535))
    return "port 须为 1-65535 整数";
  if (typeof c.username !== "string" || c.username.length === 0 || c.username.length > 128)
    return "username 必填";
  if (c.authType !== "password" && c.authType !== "privateKey")
    return "authType 须为 password 或 privateKey";
  if (c.authType === "password" && typeof c.password !== "string") return "password 必填（authType=password）";
  if (c.authType === "privateKey" && typeof c.privateKey !== "string") return "privateKey 必填（authType=privateKey）";
  if (typeof c.command !== "string" || c.command.length === 0 || c.command.length > 2048)
    return "command 必填（≤2048 字符）";
  if (c.timeoutMs !== undefined && (!Number.isInteger(c.timeoutMs) || c.timeoutMs < 100 || c.timeoutMs > 30_000))
    return "timeoutMs 须为 100-30000 整数";
  return null;
}

function normalize(v: unknown): SshConfig | null {
  if (firstError(v)) return null;
  const c = v as SshConfig;
  return {
    host: c.host.trim(),
    port: c.port ?? 22,
    username: c.username,
    authType: c.authType,
    password: c.password,
    privateKey: c.privateKey,
    command: c.command,
    timeoutMs: c.timeoutMs ?? 10_000,
  };
}

export const configSchema = { safeParse: (v: unknown) => ({ success: normalize(v) !== null }) };

export function createPlugin(): SamplerPlugin {
  return {
    protocol: "ssh",
    configSchema,
    buildSampler(config: unknown): Sampler {
      const err = firstError(config);
      if (err) throw new Error(`ssh 配置非法：${err}`);
      const cfg = normalize(config)!;
      return {
        run: (): Promise<SamplerResult> =>
          new Promise((resolve) => {
            const started = Date.now();
            const { host, port } = parseHostPort(cfg.host, cfg.port, 22);
            const client = new SshClient();
            let settled = false;
            const finish = (code: number, text: string) => {
              if (settled) return;
              settled = true;
              client.end();
              resolve({
                ok: code === 0,
                code,
                bodyText: truncateBody(text),
                responseTimeMs: Date.now() - started,
              });
            };
            const timer = setTimeout(
              () => finish(1, `exec 等待超时（${cfg.timeoutMs}ms）`),
              cfg.timeoutMs,
            );
            const finishClear = (code: number, text: string) => {
              clearTimeout(timer);
              finish(code, text);
            };
            client
              .on("ready", () => {
                client.exec(cfg.command, (execErr, stream) => {
                  if (execErr) return finishClear(2, execErr.message);
                  const chunks: string[] = [];
                  // exit 必须第一个监听（先于 data flowing）——ssh2 的 exit-status 在
                  // stream 进入 flowing 后不再单独 emit（flowing 竞态，勘误 4）
                  let exitCode: number | null | undefined;
                  stream.once("exit", (code: number | null) => {
                    exitCode = code;
                    // data 帧与 exit-status 同 tick 竞争——延迟一拍让 stdout 先收（勘误 4 配套）
                    setImmediate(() => {
                      const body = chunks.join("");
                      finishClear(code === 0 ? 0 : 4, code === 0 ? body : `exit ${code ?? "?"}\n${body}`);
                    });
                  });
                  stream.on("data", (d: Buffer) => chunks.push(d.toString("utf8")));
                  stream.stderr.on("data", (d: Buffer) => chunks.push(d.toString("utf8")));
                  stream.once("close", () => {
                    if (exitCode !== undefined) return;
                    finishClear(4, `exit ?\n${chunks.join("")}`);
                  });
                });
              })
              .on("error", (err: Error) => {
                const msg = err.message;
                finishClear(
                  /authentication|access denied|permission denied|handshake.*rejected/i.test(msg) ? 3 : 2,
                  msg,
                );
              })
              .connect({
                host,
                port,
                username: cfg.username,
                password: cfg.authType === "password" ? cfg.password : undefined,
                privateKey: cfg.authType === "privateKey" ? cfg.privateKey : undefined,
                readyTimeout: cfg.timeoutMs,
              });
          }),
      };
    },
  };
}

export default createPlugin;
