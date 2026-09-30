/** PLUG-004-T1/T2/T4：sql-guard 词法白名单矩阵 + driver-kit 工具 + 数据源/处理器 schema。 */
import { describe, expect, it } from "vitest";
import {
  assertReadOnlySelect,
  SqlGuardError,
  DRIVERS,
  DRIVER_META,
  parseDbUrl,
  replaceQuestionPlaceholders,
  normalizeRows,
  zipRows,
  friendlyDbError,
  raceTimeout,
} from "../index";
import { datasourceTestSchema } from "../api/schemas";
import { envDatasourceSchema, processorSchema } from "../execution/schemas";

describe("PLUG-004-T1 sql-guard 只读白名单", () => {
  const ok = (sql: string) => expect(() => assertReadOnlySelect(sql)).not.toThrow();
  const bad = (sql: string, hint?: string) =>
    expect(() => assertReadOnlySelect(sql)).toThrow(
      hint ? new RegExp(hint) : SqlGuardError,
    );

  it("合法：SELECT/WITH/大小写/尾分号/绑定占位符", () => {
    ok("SELECT 1");
    ok("select id, name from t where id = ?");
    ok("  WITH c AS (SELECT 1) SELECT * FROM c  ");
    ok("SELECT 1;");
    ok("SELECT 'select' AS literal");
    ok("SELECT `into` FROM quoted_mysql_identifier");
  });

  it("非法：非 SELECT/WITH 起始", () => {
    bad("UPDATE t SET a = 1", "SELECT/WITH");
    bad("DELETE FROM t", "SELECT/WITH");
    bad("INSERT INTO t VALUES (1)", "SELECT/WITH");
    bad("DROP TABLE t", "SELECT/WITH");
    bad("TRUNCATE TABLE t", "SELECT/WITH");
  });

  it("非法：多条语句与注释藏分号", () => {
    bad("SELECT 1; SELECT 2", "单条语句");
    bad("SELECT 1; DROP TABLE t", "单条语句");
    bad("SELECT 1 /* ; */ , 2", "单条语句");
  });

  it("非法：写/锁语义 token（字面量剥除后词边界匹配）", () => {
    bad("SELECT * INTO new_t FROM t", "INTO");
    bad("SELECT * FROM t FOR UPDATE", "FOR\\s+UPDATE");
    bad("select * from t for share", "FOR\\s+SHARE");
  });

  it("合法：注释内容不参与判定（注入面=原文分号，已单独拦截）", () => {
    ok("SELECT 1 /* FOR UPDATE */");
    ok("SELECT 1 -- into");
  });

  it("合法：字面量内含禁用词不被误伤", () => {
    ok("SELECT 'insert into x' AS tip");
    ok("SELECT 'FOR UPDATE' AS tip");
  });

  it("非法：空/纯注释/未闭合注释", () => {
    bad("", "为空");
    bad("   ", "为空");
    bad("-- only comment", "SELECT/WITH");
    bad("SELECT 1 /* unclosed", "未闭合");
  });
});

describe("PLUG-004-T2 driver-kit", () => {
  it("parseDbUrl：五家 scheme 白名单+默认端口+凭据解析+脱敏", () => {
    const pg = parseDbUrl("postgresql://u:p%40x@h:5432/db", "postgresql");
    expect(pg).toMatchObject({ user: "u", password: "p@x", host: "h", port: 5432, path: "db" });
    expect(pg.redacted).toBe("postgresql://h:5432");
    expect(parseDbUrl("mysql://u@h/db", "mysql")).toMatchObject({ port: 3306, path: "db" });
    expect(parseDbUrl("oracle://u:p@h:1521/SVC", "oracle")).toMatchObject({ port: 1521, path: "SVC" });
    expect(parseDbUrl("sqlserver://u:p@h?encrypt=false", "sqlserver")).toMatchObject({
      port: 1433,
      path: "",
    });
    expect(parseDbUrl("dm://u:p@h", "dm")).toMatchObject({ port: 5236 });
    expect(() => parseDbUrl("mysql://h/db", "postgresql")).toThrow("须以 postgresql:// 开头");
  });

  it("replaceQuestionPlaceholders：跳过字面量/注释；三种风格计数", () => {
    expect(replaceQuestionPlaceholders("a = ? AND b = ?", "dollar")).toEqual({
      sql: "a = $1 AND b = $2",
      count: 2,
    });
    expect(replaceQuestionPlaceholders("a = ? AND b = ?", "colon")).toEqual({
      sql: "a = :1 AND b = :2",
      count: 2,
    });
    expect(replaceQuestionPlaceholders("a = ? AND b = ?", "at")).toEqual({
      sql: "a = @p0 AND b = @p1",
      count: 2,
    });
    // 字面量与注释内的 ? 不替换（防语句语义被改写）
    expect(replaceQuestionPlaceholders("t = 'why?' -- note ?\nAND x = ?", "dollar").sql).toBe(
      "t = 'why?' -- note ?\nAND x = $1",
    );
    expect(replaceQuestionPlaceholders("/* ? */ x = ?", "colon").sql).toBe("/* ? */ x = :1");
    expect(replaceQuestionPlaceholders("SELECT 1", "dollar")).toEqual({ sql: "SELECT 1", count: 0 });
  });

  it("normalizeRows/zipRows：值归一化+行数上限+列名小写", () => {
    const rows = normalizeRows([
      { a: 1, b: new Date(Date.UTC(2026, 8, 30)), c: Buffer.from("hi"), d: null, e: { x: 1 } },
    ]);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toMatchObject({ a: 1, d: null });
    expect(typeof rows.rows[0]!.b).toBe("string");
    expect(rows.rows[0]!.c).toBe(Buffer.from("hi").toString("base64"));
    expect(typeof rows.rows[0]!.e).toBe("string");
    const many = normalizeRows(Array.from({ length: 150 }, (_, i) => ({ i })));
    expect(many.rows.length).toBe(100);
    expect(many.rowCount).toBe(150);
    const zipped = zipRows([[1, "x"]], [{ name: "ID" }, { name: "NAME" }]);
    expect(zipped.rows[0]).toEqual({ id: 1, name: "x" });
  });

  it("friendlyDbError：五类网络/认证形态映射为中文", () => {
    expect(friendlyDbError(new Error("connect ECONNREFUSED 1.2.3.4:5432"), "pg://h:1")).toContain(
      "连接被拒绝",
    );
    expect(friendlyDbError(new Error("ETIMEDOUT"), "pg://h:1")).toContain("超时");
    expect(friendlyDbError(new Error("getaddrinfo ENOTFOUND h"), "pg://h:1")).toContain("解析失败");
    expect(friendlyDbError(new Error("NJS-503: could not be established"), "o://h:1")).toContain(
      "连接失败",
    );
    expect(friendlyDbError(new Error("ORA-01017: invalid username/password"), "o://h:1")).toContain(
      "认证失败",
    );
    expect(friendlyDbError(new Error("weird"), "o://h:1")).toBe("weird");
  });

  it("raceTimeout：超时抛错/正常透传", async () => {
    await expect(raceTimeout(new Promise(() => {}), 20, "查询")).rejects.toThrow("查询超时");
    await expect(raceTimeout(Promise.resolve(7), 1000, "x")).resolves.toBe(7);
  });
});

describe("PLUG-004-T4 schema：driver 枚举与 URL 约定", () => {
  it("DRIVERS/DRIVER_META 五家齐全且占位符合 scheme", () => {
    expect(DRIVERS).toEqual(["postgresql", "mysql", "oracle", "sqlserver", "dm"]);
    for (const d of DRIVERS) {
      const meta = DRIVER_META[d];
      expect(meta.urlPlaceholder.startsWith(`${d}://`)).toBe(true);
      expect(meta.paramStyle).toBeTruthy();
    }
  });

  it("datasourceTestSchema：合法/非法 scheme 组合", () => {
    expect(
      datasourceTestSchema.safeParse({ driver: "dm", url: "dm://u:p@h:5236" }).success,
    ).toBe(true);
    expect(
      datasourceTestSchema.safeParse({ driver: "dm", url: "mysql://u:p@h" }).success,
    ).toBe(false);
    expect(
      datasourceTestSchema.safeParse({ driver: "db2", url: "db2://h" }).success,
    ).toBe(false);
    expect(datasourceTestSchema.safeParse({ driver: "mysql" }).success).toBe(false);
  });

  it("envDatasourceSchema：driver 枚举+URL 前缀校验", () => {
    expect(
      envDatasourceSchema.safeParse({ id: "a", name: "n", driver: "oracle", url: "oracle://u:p@h:1521/S" })
        .success,
    ).toBe(true);
    expect(
      envDatasourceSchema.safeParse({ id: "a", name: "n", driver: "oracle", url: "postgresql://h" })
        .success,
    ).toBe(false);
    // 历史 PG 数据源兼容
    expect(
      envDatasourceSchema.safeParse({ id: "a", name: "n", driver: "postgresql", url: "postgresql://h/db" })
        .success,
    ).toBe(true);
  });

  it("processorSchema sql：params var/value 二选一 + 数量上限", () => {
    expect(
      processorSchema.safeParse({
        kind: "sql",
        sql: "SELECT ?",
        datasourceId: "d",
        params: [{ var: "a" }, { value: "1" }],
        varMapping: {},
      }).success,
    ).toBe(true);
    expect(
      processorSchema.safeParse({
        kind: "sql",
        sql: "SELECT ?",
        datasourceId: "d",
        params: [{ var: "a", value: "both" }],
        varMapping: {},
      }).success,
    ).toBe(false);
    expect(
      processorSchema.safeParse({
        kind: "sql",
        sql: "SELECT 1",
        datasourceId: "d",
        varMapping: {},
      }).data,
    ).toMatchObject({ params: [] });
  });
});
