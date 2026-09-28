/** S-future PLUG-003-T2/T3/T4：mqtt 插件（内嵌 mini broker + 编解码/通配矩阵 + 契约） */
import { describe, expect, it, afterEach } from "vitest";
import net from "node:net";
import createMqttPlugin, {
  decodeRemainingLength,
  encodeRemainingLength,
  topicMatches,
} from "../../../../plugins/mqtt/index";

/** mini broker：CONNECT→CONNACK(rc)、SUBSCRIBE→SUBACK、客户端 PUBLISH→按订阅过滤回投（echo 模式） */
function startMiniBroker(opts: { connackRc?: number; silent?: boolean; port?: number } = {}) {
  const rc = opts.connackRc ?? 0;
  const filters: string[] = [];
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (buffer.length < 2) return;
        // 剩余长度探测（复用插件导出的解码器；length 帧总长=头+体）
        const rl = decodeRemainingLength(buffer, 1);
        if (!rl) return;
        const total = rl.bytes + rl.value;
        if (buffer.length < total) return;
        const typeByte = buffer[0]! >> 4;
        const body = buffer.subarray(rl.bytes, total);
        buffer = buffer.subarray(total);
        if (typeByte === 1) socket.write(Buffer.from([0x20, 0x02, 0x00, rc]));
        else if (typeByte === 8) {
          const pid = body.subarray(0, 2);
          const topicLen = (body[2]! << 8) | body[3]!;
          const filter = body.subarray(4, 4 + topicLen).toString("utf8");
          filters.push(filter);
          socket.write(Buffer.concat([Buffer.from([0x90, 0x03]), pid, Buffer.from([0x00])]));
        } else if (typeByte === 3) {
          if (opts.silent) continue;
          const topicLen = (body[0]! << 8) | body[1]!;
          const topic = body.subarray(2, 2 + topicLen).toString("utf8");
          const payload = body.subarray(2 + topicLen).toString("utf8");
          const echoTopic = Buffer.from(topic, "utf8");
          const frameBody = Buffer.concat([
            Buffer.from([echoTopic.length >> 8, echoTopic.length & 0xff]),
            echoTopic,
            Buffer.from(payload, "utf8"),
          ]);
          const len = encodeRemainingLength(frameBody.length);
          socket.write(Buffer.concat([Buffer.from([0x30]), len, frameBody]));
        } else if (typeByte === 14) socket.destroy();
      }
    });
  });
  return new Promise<{ port: number; close(): Promise<void> }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("no port"));
      resolve({ port: addr.port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()));
});

const plugin = createMqttPlugin();

describe("PLUG-003-T3 mqtt 编解码（剩余长度 varint）", () => {
  it.each([0, 1, 127, 128, 16383, 2097152])("往返 %i", (n) => {
    const enc = encodeRemainingLength(n);
    const buf = Buffer.concat([Buffer.from([0x30]), enc]);
    const decoded = decodeRemainingLength(buf, 1);
    expect(decoded?.value).toBe(n);
    expect(decoded?.bytes).toBe(1 + enc.length);
  });

  it("通配匹配矩阵", () => {
    expect(topicMatches("demo/a", "demo/a")).toBe(true);
    expect(topicMatches("demo/a", "demo/b")).toBe(false);
    expect(topicMatches("demo/+", "demo/b")).toBe(true);
    expect(topicMatches("demo/+", "demo/b/c")).toBe(false);
    expect(topicMatches("demo/#", "demo")).toBe(true);
    expect(topicMatches("demo/#", "demo/b/c")).toBe(true);
    expect(topicMatches("+/b", "a/b")).toBe(true);
  });
});

describe("PLUG-003-T2/T4 mqtt 插件采样", () => {
  it("契约：name=protocol 标识 + configSchema 拒绝非法", () => {
    expect(plugin.protocol).toBe("mqtt");
    expect(plugin.configSchema.safeParse({ host: "127.0.0.1", topic: "demo/a" }).success).toBe(
      true,
    );
    expect(plugin.configSchema.safeParse({ host: "", topic: "a" }).success).toBe(false);
    expect(plugin.configSchema.safeParse({ host: "x", topic: "a", port: 70000 }).success).toBe(
      false,
    );
    expect(() => plugin.buildSampler({ host: "x" } as never)).toThrow(/配置非法/);
  });

  it("正常路径：订阅→发布→收投递 ok=true", async () => {
    const broker = await startMiniBroker();
    closers.push(broker.close);
    const sampler = plugin.buildSampler({
      host: "127.0.0.1",
      port: broker.port,
      topic: "demo/a",
      publish: { payload: "ping-rabbit" },
    });
    const res = await sampler.run();
    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
    expect(res.bodyText).toBe("ping-rabbit");
    expect(res.headers?.topic).toBe("demo/a");
  });

  it("通配订阅：demo/+ 收到 demo/b 投递", async () => {
    const broker = await startMiniBroker();
    closers.push(broker.close);
    const res = await plugin
      .buildSampler({
        host: "127.0.0.1",
        port: broker.port,
        topic: "demo/+",
        publish: { topic: "demo/b", payload: "wild" },
        timeoutMs: 3000,
      })
      .run();
    expect(res.ok).toBe(true);
    expect(res.bodyText).toBe("wild");
  });

  it("CONNACK 拒绝（rc=5）→ 502 语义", async () => {
    const broker = await startMiniBroker({ connackRc: 5 });
    closers.push(broker.close);
    const res = await plugin
      .buildSampler({
        host: "127.0.0.1",
        port: broker.port,
        topic: "demo/a",
        timeoutMs: 3000,
      })
      .run();
    expect(res.ok).toBe(false);
    expect(res.code).toBe(2);
    expect(res.bodyText).toContain("CONNACK rejected");
  });

  it("静默 broker（无投递）→ 超时 504 语义", async () => {
    const broker = await startMiniBroker({ silent: true });
    closers.push(broker.close);
    const res = await plugin
      .buildSampler({
        host: "127.0.0.1",
        port: broker.port,
        topic: "demo/a",
        timeoutMs: 300,
      })
      .run();
    expect(res.ok).toBe(false);
    expect(res.code).toBe(1);
    expect(res.bodyText).toContain("timeout");
  });

  it("连接拒绝（无监听端口）→ 502 语义", async () => {
    const res = await plugin
      .buildSampler({
        host: "127.0.0.1",
        port: 1,
        topic: "demo/a",
        timeoutMs: 2000,
      })
      .run();
    expect(res.ok).toBe(false);
    expect(res.code).toBe(2);
  }, 8000);
});
