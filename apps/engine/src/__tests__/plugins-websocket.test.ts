/** S-future PLUG-003-T1：websocket 协议插件（内嵌 RFC6455 echo 服务器，三态：回显/超时/拒绝） */
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import createWebsocketPlugin from "../../../../plugins/websocket/index";
import { startWsEchoServer, type WsEchoServer } from "./ws-echo-server";

let echo: WsEchoServer;

beforeAll(async () => {
  echo = await startWsEchoServer();
});
afterAll(async () => {
  await echo.close();
});

const plugin = createWebsocketPlugin();

describe("PLUG-003-T1 websocket 插件", () => {
  it("契约：name=protocol 标识 + spiVersion 语义（防 tcp-conn 类漂移）", () => {
    expect(plugin.protocol).toBe("websocket");
    expect(plugin.configSchema.safeParse({ url: "ws://127.0.0.1:1/x" }).success).toBe(true);
    expect(plugin.configSchema.safeParse({ url: "http://127.0.0.1:1/x" }).success).toBe(false);
    expect(
      plugin.configSchema.safeParse({ url: "ws://a", sendText: "a", sendBinaryBase64: "Yg==" })
        .success,
    ).toBe(false);
    expect(plugin.configSchema.safeParse({ url: "ws://a", timeoutMs: 20000 }).success).toBe(false);
  });

  it("正常路径：sendText 回显 ok=true（text 帧）", async () => {
    const sampler = plugin.buildSampler({
      url: `ws://127.0.0.1:${echo.port}/ws/echo`,
      sendText: "hello rabbit",
    });
    const res = await sampler.run();
    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
    expect(res.bodyText).toBe("hello rabbit");
    expect(res.headers?.frame).toBe("text");
    expect(res.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("二进制帧：sendBinaryBase64 回显（lossy UTF-8 展示 + binary 标记）", async () => {
    const sampler = plugin.buildSampler({
      url: `ws://127.0.0.1:${echo.port}/ws/echo`,
      sendBinaryBase64: Buffer.from("bin-rabbit").toString("base64"),
    });
    const res = await sampler.run();
    expect(res.ok).toBe(true);
    expect(res.bodyText).toBe("bin-rabbit");
    expect(res.headers?.frame).toBe("binary");
  });

  it("不发送：等待服务端首条消息（echo 服务器静默时超时 504 语义）", async () => {
    // 复用 echo 服务器但不发送——echo 服务器不会主动推消息，等待首包必然超时
    const sampler = plugin.buildSampler({
      url: `ws://127.0.0.1:${echo.port}/ws/echo`,
      timeoutMs: 300,
    });
    const res = await sampler.run();
    expect(res.ok).toBe(false);
    expect(res.code).toBe(1); // 引擎映射 504
    expect(res.bodyText).toContain("timeout");
  });

  it("连接拒绝：无监听端口 → 502 语义", async () => {
    const sampler = plugin.buildSampler({
      url: "ws://127.0.0.1:1/no-listener",
      sendText: "x",
      timeoutMs: 2000,
    });
    const res = await sampler.run();
    expect(res.ok).toBe(false);
    expect(res.code).toBe(2); // 引擎映射 502
  }, 8000);

  it("非法配置：buildSampler 抛错（引擎 CONFIG_ERROR/40510 链路）", () => {
    expect(() => plugin.buildSampler({ url: "not-a-ws-url" })).toThrow(/配置非法/);
  });
});
