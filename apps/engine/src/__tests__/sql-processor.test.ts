/** PLUG-004-T3：SQL 前后置处理器（伪驱动注入注册表，全分支 CONFIG_ERROR 语义 + 成功提取）。 */
import { describe, expect, it, beforeEach } from "vitest";
import { runProcessors, ProcessorError } from "../kernel/processors";
import { __setDriverForTests } from "../kernel/drivers/registry";
import type { DriverPlugin, EnvSnapshot } from "@rabbit/shared";

const env: EnvSnapshot = {
  vars: {},
  http: [],
  hosts: [],
  database: [
    { id: "ds1", name: "订单库", driver: "postgresql", url: "postgresql://u:p@127.0.0.1:5599/db" },
  ],
  pre: [],
  post: [],
  asserts: [],
  extracts: [],
};

beforeEach(() => {
  __setDriverForTests("postgresql", null);
});

describe("PLUG-004-T3 SQL 处理器（解禁后语义）", () => {
  it("成功：查询→首行 varMapping 写入 ctx.vars（列名→变量）+ 日志摘要", async () => {
    const calls: Array<{ url: string; req: unknown }> = [];
    const fake: DriverPlugin = {
      driver: "postgresql",
      testConnection: async () => {},
      query: async (config, req) => {
        calls.push({ url: config.url, req });
        return {
          rows: [{ id: 42, status: "PAID" }],
          rowCount: 1,
          ms: 3,
        };
      },
    };
    __setDriverForTests("postgresql", fake);
    const vars: Record<string, string> = { tenant: "t_1001" };
    const logs: string[] = [];
    await runProcessors(
      [
        {
          kind: "sql",
          sql: "SELECT id, status FROM orders WHERE tenant = ?",
          datasourceId: "ds1",
          params: [{ var: "tenant" }, { value: "2026-01-01" }],
          varMapping: { id: "orderId", status: "orderStatus" },
        },
      ],
      { vars, env, logs },
    );
    expect(vars).toMatchObject({ orderId: "42", orderStatus: "PAID", tenant: "t_1001" });
    expect(calls[0]!.url).toBe(env.database[0]!.url);
    expect(calls[0]!.req).toMatchObject({ readOnly: true });
    // 参数绑定：{var} 解析为运行时值、{value} 字面值——SQL 文本不含任何变量值
    expect((calls[0]!.req as { params: Array<{ value: unknown }> }).params).toEqual([
      { value: "t_1001" },
      { value: "2026-01-01" },
    ]);
    expect(logs[0]).toContain("[sql] postgresql rows=1");
  });

  it("数据源不存在（未选环境）→ CONFIG_ERROR", async () => {
    await expect(
      runProcessors(
        [{ kind: "sql", sql: "SELECT 1", datasourceId: "nope", params: [], varMapping: {} }],
        { vars: {}, env: undefined, logs: [] },
      ),
    ).rejects.toMatchObject({
      kind: "CONFIG_ERROR",
      message: expect.stringContaining("SQL 数据源不存在"),
    });
  });

  it("环境内无该数据源 id → CONFIG_ERROR", async () => {
    await expect(
      runProcessors(
        [{ kind: "sql", sql: "SELECT 1", datasourceId: "other", params: [], varMapping: {} }],
        { vars: {}, env, logs: [] },
      ),
    ).rejects.toMatchObject({ kind: "CONFIG_ERROR", message: expect.stringContaining("不存在") });
  });

  it("非 SELECT/WITH → [50031] SQL_NOT_SELECT（白名单先于驱动执行）", async () => {
    let hit = 0;
    __setDriverForTests("postgresql", {
      driver: "postgresql",
      testConnection: async () => {},
      query: async () => {
        hit += 1;
        return { rows: [], rowCount: 0, ms: 0 };
      },
    });
    await expect(
      runProcessors(
        [
          {
            kind: "sql",
            sql: "UPDATE t SET a = 1",
            datasourceId: "ds1",
            params: [],
            varMapping: {},
          },
        ],
        { vars: {}, env, logs: [] },
      ),
    ).rejects.toMatchObject({
      kind: "CONFIG_ERROR",
      message: expect.stringContaining("50031"),
    });
    expect(hit).toBe(0);
  });

  it("驱动插件未启用 → [50032] DRIVER_PLUGIN_MISSING", async () => {
    await expect(
      runProcessors(
        [{ kind: "sql", sql: "SELECT 1", datasourceId: "ds1", params: [], varMapping: {} }],
        { vars: {}, env, logs: [] },
      ),
    ).rejects.toMatchObject({
      kind: "CONFIG_ERROR",
      message: expect.stringContaining("50032"),
    });
  });

  it("驱动执行异常 → CONFIG_ERROR 且带驱动侧 message", async () => {
    __setDriverForTests("postgresql", {
      driver: "postgresql",
      testConnection: async () => {},
      query: async () => {
        throw new Error("连接被拒绝（postgresql://127.0.0.1:5599）");
      },
    });
    await expect(
      runProcessors(
        [{ kind: "sql", sql: "SELECT 1", datasourceId: "ds1", params: [], varMapping: {} }],
        { vars: {}, env, logs: [] },
      ),
    ).rejects.toBeInstanceOf(ProcessorError);
  });

  it("空结果集：varMapping 不写入任何变量（首行不存在）", async () => {
    __setDriverForTests("postgresql", {
      driver: "postgresql",
      testConnection: async () => {},
      query: async () => ({ rows: [], rowCount: 0, ms: 1 }),
    });
    const vars: Record<string, string> = {};
    await runProcessors(
      [
        {
          kind: "sql",
          sql: "SELECT id FROM orders WHERE 1 = 0",
          datasourceId: "ds1",
          params: [],
          varMapping: { id: "orderId" },
        },
      ],
      { vars, env, logs: [] },
    );
    expect(vars).toEqual({});
  });
});
