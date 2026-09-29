/**
 * tcp-conn 协议插件（PLUG-002 §1.2 示例）：TCP 连通性采样（connect + 握手延迟）。
 * engine 进程内加载（采样热路径不跨进程——plugin-architecture §2）。
 * TCP 全语义（发包/断言）登记 P4。
 */
import net from "node:net";

export interface TcpConfig {
  host: string;
  port: number;
  timeoutMs?: number;
}

function isTcpConfig(v: unknown): v is TcpConfig {
  const c = v as TcpConfig;
  return (
    typeof c?.host === "string" &&
    c.host.length > 0 &&
    typeof c?.port === "number" &&
    Number.isInteger(c.port) &&
    c.port > 0 &&
    c.port < 65536
  );
}

export const configSchema = { safeParse: (v: unknown) => ({ success: isTcpConfig(v) }) };

export default function createTcpConnPlugin() {
  return {
    protocol: "tcp" as const,
    configSchema,
    buildSampler(config: unknown) {
      if (!isTcpConfig(config)) throw new Error("tcp 配置非法：需要 host 与 port（1-65535）");
      return {
        run: () =>
          new Promise<{ ok: boolean; code: number; bodyText: string; responseTimeMs: number }>(
            (resolve) => {
              const started = Date.now();
              const socket = net.createConnection({ host: config.host, port: config.port });
              const timeout = config.timeoutMs ?? 5000;
              const finish = (ok: boolean, code: number, text: string) => {
                socket.destroy();
                resolve({ ok, code, bodyText: text, responseTimeMs: Date.now() - started });
              };
              socket.setTimeout(timeout, () =>
                finish(false, 1, `connect timeout after ${timeout}ms`),
              );
              socket.on("connect", () =>
                finish(true, 0, `connected ${config.host}:${config.port}`),
              );
              socket.on("error", (err) => {
                const refused = /ECONNREFUSED/.test(err.message);
                finish(false, refused ? 2 : 3, err.message);
              });
            },
          ),
      };
    },
  };
}
