/**
 * PLUG-005-T2：redis 协议插件（内嵌 mini RESP server——PING/ECHO/GET/SET 四命令+错误回复；
 * 黑名单拦截不触达 server 的举证=server 端命令计数器）。
 */
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import createRedisPlugin from "../../../../plugins/redis/index";
import net from "node:net";

let server: net.Server;
let port: number;
let receivedCommands: string[] = [];

/** mini RESP 编解码（仅内嵌测试目标用——单行解析足够） */
function encodeSimple(s: string): Buffer {
  return Buffer.from(`+${s}\r\n`);
}
function encodeError(s: string): Buffer {
  return Buffer.from(`-${s}\r\n`);
}
function encodeBulk(s: string | null): Buffer {
  if (s === null) return Buffer.from("$-1\r\n");
  return Buffer.from(`$${Buffer.byteLength(s)}\r\n${s}\r\n`);
}

beforeAll(async () => {
  const kv = new Map<string, string>([["k1", "v1"]]);
  server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      // 逐条解析 RESP 数组（*N\r\n$len\r\narg\r\n...）——内嵌目标只收完整命令
      for (;;) {
        const str = buf.toString("utf8");
        if (!str.startsWith("*")) return;
        const end = str.indexOf("\r\n");
        if (end === -1) return;
        const argc = Number(str.slice(1, end));
        // 简单按 \r\n 分割提取参数（内嵌目标无嵌套 bulk）
        const parts = str.split("\r\n").filter((p) => !p.startsWith("$") && p !== "" && !p.startsWith("*"));
        if (parts.length < argc) return;
        const args = parts.slice(0, argc);
        buf = Buffer.from(str.slice(str.indexOf(args[argc - 1]!) + args[argc - 1]!.length + 2));
        const cmd = (args[0] ?? "").toUpperCase();
        receivedCommands.push(cmd);
        switch (cmd) {
          case "PING":
            sock.write(encodeSimple("PONG"));
            break;
          case "ECHO":
            sock.write(encodeBulk(args[1] ?? ""));
            break;
          case "GET":
            sock.write(encodeBulk(kv.get(args[1]!) ?? null));
            break;
          case "SET":
            kv.set(args[1]!, args[2] ?? "");
            sock.write(encodeSimple("OK"));
            break;
          case "QUIT":
            sock.write(encodeSimple("OK"));
            sock.end();
            break;
          case "INFO":
            // ioredis 连接后自动发 INFO 探活——内嵌目标回最小合法段
            sock.write(encodeBulk("# Server\r\nredis_version:7.0.0-test\r\n"));
            break;
          default:
            sock.write(encodeError(`ERR unknown command '${cmd}'`));
        }
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
});

afterAll(() => {
  server?.close();
});

const plugin = createRedisPlugin();

describe("PLUG-005-T2 redis 插件（内嵌 mini RESP server）", () => {
  it("契约：name=protocol + configSchema 合法/非法样本", () => {
    expect(plugin.protocol).toBe("redis");
    expect(plugin.configSchema.safeParse({ host: "h", port: 6379, command: "PING" }).success).toBe(true);
    expect(plugin.configSchema.safeParse({ host: "h", command: "PING" }).success).toBe(false); // 缺 port
    expect(plugin.configSchema.safeParse({ url: "not-redis://h", command: "PING" }).success).toBe(false);
  });

  it("PING：成功回 PONG（url 形态）", async () => {
    receivedCommands = [];
    const r = await plugin
      .buildSampler({ url: `redis://127.0.0.1:${port}`, command: "PING", timeoutMs: 5000 })
      .run();
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
    expect(r.bodyText).toBe("PONG");
    expect(receivedCommands).toContain("PING");
  });

  it("GET：命中返回值（host+port 形态）", async () => {
    const r = await plugin
      .buildSampler({ host: "127.0.0.1", port, command: "GET", args: ["k1"], timeoutMs: 5000 })
      .run();
    expect(r.ok).toBe(true);
    expect(r.bodyText).toBe("v1");
  });

  it("黑名单：FLUSHALL 被拦截且 server 未收到（举证=命令计数器）", async () => {
    receivedCommands = [];
    const r = await plugin
      .buildSampler({ host: "127.0.0.1", port, command: "FLUSHALL", timeoutMs: 1000 })
      .run();
    expect(r.ok).toBe(false);
    expect(r.code).toBe(4);
    expect(r.bodyText).toContain("危险命令被拒绝");
    expect(receivedCommands).toEqual([]);
  });

  it("EVAL 同样在黑名单（沙箱外 Lua）", async () => {
    receivedCommands = [];
    const r = await plugin
      .buildSampler({ host: "127.0.0.1", port, command: "EVAL", args: ["return 1", "0"], timeoutMs: 1000 })
      .run();
    expect(r.ok).toBe(false);
    expect(r.code).toBe(4);
    expect(receivedCommands).toEqual([]);
  });

  it("未知命令：server 错误回复 → code=2（协议错误映射）", async () => {
    const r = await plugin
      .buildSampler({ host: "127.0.0.1", port, command: "NOSUCHCMD", timeoutMs: 3000 })
      .run();
    expect(r.ok).toBe(false);
    expect(r.code).toBe(2);
    expect(r.bodyText).toContain("unknown command");
  });
});
