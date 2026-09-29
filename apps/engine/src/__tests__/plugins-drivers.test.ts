/**
 * PLUG-004-T2（插件面）：五家驱动插件契约与连接前校验分支（无需真实数据库——
 * scheme 校验与占位符计数都发生在建连之前；真实 PG 链路由 jmx/e2e 全栈覆盖，登记豁免）。
 */
import { describe, expect, it } from "vitest";
import createPostgresql from "../../../../plugins/postgresql/index";
import createMysql from "../../../../plugins/mysql/index";
import createOracle from "../../../../plugins/oracle/index";
import createSqlserver from "../../../../plugins/sqlserver/index";
import createDm from "../../../../plugins/dm/index";

const plugins = [
  { name: "postgresql", factory: createPostgresql },
  { name: "mysql", factory: createMysql },
  { name: "oracle", factory: createOracle },
  { name: "sqlserver", factory: createSqlserver },
  { name: "dm", factory: createDm },
];

describe("PLUG-004 驱动插件契约（name=driver 标识，防漂移）", () => {
  for (const { name, factory } of plugins) {
    it(`${name}：driver 标识 + testConnection/query 方法形状`, () => {
      const p = factory();
      expect(p.driver).toBe(name);
      expect(typeof p.testConnection).toBe("function");
      expect(typeof p.query).toBe("function");
    });

    it(`${name}：scheme 白名单在建连前拒绝（错误含须以前缀提示）`, async () => {
      const p = factory();
      await expect(p.testConnection({ url: "not-a-db-url" })).rejects.toThrow(
        new RegExp(`须以 ${name}:// 开头|数据源 URL`),
      );
    });
  }
});

describe("PLUG-004 占位符计数一致性（建连前校验）", () => {
  it("postgresql：占位符数≠参数数 → 显式失败", async () => {
    const p = createPostgresql();
    await expect(
      p.query({ url: "postgresql://u:p@127.0.0.1:1/db" }, { sqlText: "SELECT ?, ?", params: [{ value: "1" }] }),
    ).rejects.toThrow("占位符数量（2）与绑定参数数量（1）不一致");
  });
  it("oracle/dm/sqlserver/mysql：同规则", async () => {
    for (const factory of [createMysql, createOracle, createSqlserver, createDm]) {
      const p = factory();
      await expect(
        p.query({ url: `${p.driver}://u:p@127.0.0.1:1/x` }, { sqlText: "SELECT ?", params: [] }),
      ).rejects.toThrow("占位符数量");
    }
  });
});
