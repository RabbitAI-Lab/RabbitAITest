/**
 * sqlserver 驱动插件（PLUG-004）：mssql 12（Microsoft 官方文档指定 Node 驱动，MIT，
 * 底层 tedious 纯 JS TDS；npm 官方 registry——来源铁律 PLUG-004 §0）。
 * 占位符归一化 `?` → `@p0,@p1…`（request.input 绑定，SQL Server 无 READ ONLY 事务——
 * 词法白名单+连接即关兜底，PLUG-004 §2.2 登记）。
 */
import type { DriverPlugin } from "../../packages/shared/src/plugins/spi";
import {
  parseDbUrl,
  replaceQuestionPlaceholders,
  normalizeRows,
  friendlyDbError,
  raceTimeout,
} from "../../packages/shared/src/plugins/driver-kit";
import sql from "mssql";

const CONNECT_TIMEOUT_MS = 3000;
const QUERY_TIMEOUT_MS = 10_000;

async function withPool<T>(
  url: string,
  fn: (pool: sql.ConnectionPool) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const parsed = parseDbUrl(url, "sqlserver");
  const encrypt = parsed.params.get("encrypt") !== "false";
  const trustServerCertificate = parsed.params.get("trustServerCertificate") === "true";
  const pool = new sql.ConnectionPool({
    server: parsed.host,
    port: parsed.port,
    user: parsed.user,
    password: parsed.password,
    database: parsed.path || undefined,
    connectionTimeout: CONNECT_TIMEOUT_MS / 1000,
    requestTimeout: timeoutMs,
    options: { encrypt, trustServerCertificate },
  });
  try {
    await raceTimeout(pool.connect(), timeoutMs, label);
    return await fn(pool);
  } catch (e) {
    throw new Error(friendlyDbError(e, parsed.redacted));
  } finally {
    await pool.close().catch(() => undefined);
  }
}
export function createPlugin(): DriverPlugin {
  return {
    driver: "sqlserver",
    async testConnection({ url }) {
      await withPool(
        url,
        async (p) => {
          await p.request().query("SELECT 1");
        },
        CONNECT_TIMEOUT_MS + 2000,
        "连接",
      );
    },
    async query({ url }, req) {
      const started = Date.now();
      const timeoutMs = req.timeoutMs ?? QUERY_TIMEOUT_MS;
      const { sql: text, count } = replaceQuestionPlaceholders(req.sqlText, "at");
      if (count !== req.params.length) {
        throw new Error(`占位符数量（${count}）与绑定参数数量（${req.params.length}）不一致`);
      }
      const values = req.params.map((p) => p.value ?? null);
      return withPool(
        url,
        async (p) => {
          const request = p.request();
          values.forEach((v, idx) => {
            // null 需显式类型（mssql 无法从 null 推断）；其余按 JS 值推断
            if (v === null) request.input(`p${idx}`, sql.NVarChar, null);
            else request.input(`p${idx}`, v);
          });
          const res = await request.query(text);
          const recordset = (res.recordset ?? []) as Record<string, unknown>[];
          const { rows, rowCount } = normalizeRows(recordset);
          return { rows, rowCount, ms: Date.now() - started };
        },
        timeoutMs,
        "查询",
      );
    },
  };
}

export default createPlugin;
