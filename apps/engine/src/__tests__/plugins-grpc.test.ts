/**
 * PLUG-005-T4：grpc 协议插件（内嵌 gRPC echo server——同进程 grpc-js server + 测试 proto，
 * unary Say 往返 / 服务端错误 status / 超时 / service 不存在四态）。day0 已验证 Say 往返。
 */
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import createGrpcPlugin from "../../../../plugins/grpc/index";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const PROTO = `syntax = "proto3";
package plug005;
service Echo {
  rpc Say (Req) returns (Res) {}
  rpc Fail (Req) returns (Res) {}
  rpc Slow (Req) returns (Res) {}
}
message Req { string text = 1; }
message Res { string text = 1; }
`;

let server: grpc.Server;
let port: number;

beforeAll(async () => {
  const protoPath = join(tmpdir(), `plug005-test-${randomUUID()}.proto`);
  writeFileSync(protoPath, PROTO);
  const pkgDef = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  rmSync(protoPath, { force: true });
  const pkg = grpc.loadPackageDefinition(pkgDef).plug005 as unknown as {
    Echo: { service: grpc.ServiceDefinition };
  };
  server = new grpc.Server();
  server.addService(pkg.Echo.service, {
    Say: (
      call: grpc.ServerUnaryCall<{ text: string }, { text: string }>,
      cb: grpc.sendUnaryData<{ text: string }>,
    ) => cb(null, { text: `got:${call.request.text}` }),
    Fail: (_call: grpc.ServerUnaryCall<unknown, unknown>, cb: grpc.sendUnaryData<unknown>) =>
      cb({ code: grpc.status.INVALID_ARGUMENT, details: "bad input" } as grpc.ServiceError, null),
    Slow: (
      call: grpc.ServerUnaryCall<{ text: string }, { text: string }>,
      cb: grpc.sendUnaryData<{ text: string }>,
    ) => setTimeout(() => cb(null, { text: "late" }), 5000),
  } as never);
  port = await new Promise<number>((res) => {
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (_e, p) => res(p));
  });
  server.start();
});

afterAll(() => {
  server?.forceShutdown();
});

const plugin = createGrpcPlugin();
const base = { host: "127.0.0.1", service: "Echo", tls: false };

describe("PLUG-005-T4 grpc 插件（内嵌 echo server）", () => {
  it("契约：name=protocol + configSchema 合法/非法样本", () => {
    expect(plugin.protocol).toBe("grpc");
    expect(
      plugin.configSchema.safeParse({
        ...base,
        port,
        protoContent: 'syntax = "proto3";',
        method: "Say",
      }).success,
    ).toBe(true);
    expect(plugin.configSchema.safeParse({ ...base, port, method: "Say" }).success).toBe(false); // 缺 proto
    expect(
      plugin.configSchema.safeParse({
        ...base,
        port,
        protoContent: "x",
        protoBase64: "eA==",
        method: "Say",
      }).success,
    ).toBe(false); // 二选一
  });

  it("unary Say 往返：code=0 且 bodyText 含响应", async () => {
    const r = await plugin
      .buildSampler({
        ...base,
        port,
        protoContent: PROTO,
        method: "Say",
        requestMessage: { text: "hello" },
        timeoutMs: 5000,
      })
      .run();
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
    expect(r.bodyText).toContain("got:hello");
  });

  it("服务端错误 status（INVALID_ARGUMENT）→ code=4 带 details", async () => {
    const r = await plugin
      .buildSampler({
        ...base,
        port,
        protoContent: PROTO,
        method: "Fail",
        requestMessage: { text: "x" },
        timeoutMs: 5000,
      })
      .run();
    expect(r.ok).toBe(false);
    expect(r.code).toBe(4);
    expect(r.bodyText).toContain("bad input");
  });

  it("超时（服务端 5s 慢响应，客户端 300ms deadline）→ code=1", async () => {
    const r = await plugin
      .buildSampler({
        ...base,
        port,
        protoContent: PROTO,
        method: "Slow",
        requestMessage: { text: "x" },
        timeoutMs: 300,
      })
      .run();
    expect(r.ok).toBe(false);
    expect(r.code).toBe(1);
  });

  it("service 不存在 → code=4 且 bodyText 含可用列表", async () => {
    const r = await plugin
      .buildSampler({
        ...base,
        port,
        protoContent: PROTO,
        service: "NoSuch",
        method: "Say",
        timeoutMs: 1000,
      })
      .run();
    expect(r.ok).toBe(false);
    expect(r.code).toBe(4);
    expect(r.bodyText).toContain("service 不存在");
    expect(r.bodyText).toContain("Echo");
  });
});
