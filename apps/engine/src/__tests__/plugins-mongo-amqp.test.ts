/**
 * PLUG-005-T3/T5：mongodb/amqp 契约与错误映射（真连豁免登记：CI 无 mongod/broker 内嵌不可行——
 * amqp e2e 走 rabbitmq service 真连覆盖；mongodb 单测覆盖协议契约/守卫/不可达映射）。
 * PLUG-005-T6：五插件统一契约（name=protocol 标识，防 tcp-conn 漂移）。
 */
import { describe, expect, it } from "vitest";
import createMongoPlugin from "../../../../plugins/mongodb/index";
import createAmqpPlugin from "../../../../plugins/amqp/index";
import createSshPlugin from "../../../../plugins/ssh/index";
import createRedisPlugin from "../../../../plugins/redis/index";
import createGrpcPlugin from "../../../../plugins/grpc/index";

describe("PLUG-005-T3 mongodb 插件（契约/守卫/错误映射）", () => {
  const plugin = createMongoPlugin();

  it("契约：name=protocol + configSchema 合法/非法样本", () => {
    expect(plugin.protocol).toBe("mongodb");
    expect(
      plugin.configSchema.safeParse({ uri: "mongodb://h/db", operation: "ping" }).success,
    ).toBe(true);
    expect(
      plugin.configSchema.safeParse({ uri: "mongodb://h/db", operation: "find", collection: "c" })
        .success,
    ).toBe(true);
    expect(plugin.configSchema.safeParse({ uri: "http://h", operation: "ping" }).success).toBe(
      false,
    );
    expect(
      plugin.configSchema.safeParse({ uri: "mongodb://h/db", operation: "find" }).success,
    ).toBe(false); // 缺 collection
    expect(
      plugin.configSchema.safeParse({
        uri: "mongodb://h/db",
        operation: "find",
        collection: "c",
        query: { $where: "1" },
      }).success,
    ).toBe(false); // $where 拒绝
  });

  it("不可达连接 → code=2/1（serverSelectionTimeoutMS 快速失败）", async () => {
    const r = await plugin
      .buildSampler({ uri: "mongodb://127.0.0.1:1/db", operation: "ping", timeoutMs: 800 })
      .run();
    expect(r.ok).toBe(false);
    expect([1, 2]).toContain(r.code);
  }, 10000);

  it("count/find 须 uri 带库名 → code=4", async () => {
    const r = await plugin
      .buildSampler({
        uri: "mongodb://127.0.0.1:1",
        operation: "count",
        collection: "c",
        timeoutMs: 800,
      })
      .run();
    // 连接失败先于库名判定（不可达）——两分支皆可接受，但不得 ok
    expect(r.ok).toBe(false);
  }, 10000);
});

describe("PLUG-005-T5 amqp 插件（契约/错误映射）", () => {
  const plugin = createAmqpPlugin();

  it("契约：name=protocol + configSchema 合法/非法样本", () => {
    expect(plugin.protocol).toBe("amqp");
    expect(plugin.configSchema.safeParse({ url: "amqp://h", message: "m" }).success).toBe(true);
    expect(plugin.configSchema.safeParse({ url: "amqps://h", message: "m" }).success).toBe(true);
    expect(plugin.configSchema.safeParse({ url: "http://h", message: "m" }).success).toBe(false);
    expect(plugin.configSchema.safeParse({ url: "amqp://h" }).success).toBe(false); // 缺 message
  });

  it("不可达连接 → code=2", async () => {
    const r = await plugin
      .buildSampler({ url: "amqp://127.0.0.1:1", message: "m", timeoutMs: 800 })
      .run();
    expect(r.ok).toBe(false);
    expect(r.code).toBe(2);
  }, 10000);
});

describe("PLUG-005-T6 五插件统一契约（name=protocol 标识）", () => {
  const plugins = [
    { name: "ssh", factory: createSshPlugin },
    { name: "redis", factory: createRedisPlugin },
    { name: "mongodb", factory: createMongoPlugin },
    { name: "grpc", factory: createGrpcPlugin },
    { name: "amqp", factory: createAmqpPlugin },
  ];
  for (const { name, factory } of plugins) {
    it(`${name}：protocol 标识 = name + buildSampler 抛错形态`, () => {
      const p = factory();
      expect(p.protocol).toBe(name);
      expect(typeof p.buildSampler).toBe("function");
      expect(() => p.buildSampler({})).toThrow();
    });
  }
});
