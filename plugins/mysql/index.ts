/**
 * mysql 驱动插件（PLUG-004）：mysql2（MIT，npm 官方 registry——Oracle 无官方 Node 驱动，
 * mysql2 为生态事实标准，登记于 PLUG-004 §0）。占位符原生 `?`（无需归一化）。
 * 只读防线：词法白名单 + START TRANSACTION READ ONLY + 连接即关。
 */
import type { DriverPlugin } from "../../packages/shared/src/plugins/spi";
import {
  parseDbUrl,
  normalizeRows,
  friendlyDbError,
  raceTimeout,
} from "../../packages/shared/src/plugins/driver-kit";
import mysql from "mysql2/promise";

const CONNECT_TIMEOUT_MS = 3000;
const QUERY_TIMEOUT_MS = 10_000;

async function withConnection<T>(
  url: string,
  fn: (conn: mysql.Connection) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const parsed = parseDbUrl(url, "mysql");
  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection({
      uri: url,
      connectTimeout: CONNECT_TIMEOUT_MS,
    });
    return await raceTimeout(fn(conn), timeoutMs, label);
  } catch (e) {
    throw new Error(friendlyDbError(e, parsed.redacted));
  } finally {
    conn?.destroy();
  }
}

export function createPlugin(): DriverPlugin {
  return {
    driver: "mysql",
    async testConnection({ url }) {
      await withConnection(
        url,
        async (c) => {
          await c.query("SELECT 1");
        },
        CONNECT_TIMEOUT_MS + 2000,
        "连接",
      );
    },
    async query({ url }, req) {
      const started = Date.now();
      const timeoutMs = req.timeoutMs ?? QUERY_TIMEOUT_MS;
      const placeholders = (req.sqlText.match(/\?/g) ?? []).length;
      if (placeholders !== req.params.length) {
        throw new Error(
          `占位符数量（${placeholders}）与绑定参数数量（${req.params.length}）不一致`,
        );
      }
      const values = req.params.map((p) => p.value ?? null);
      return withConnection(
        url,
        async (c) => {
          if (req.readOnly !== false) await c.query("START TRANSACTION READ ONLY");
          try {
            // execute=服务端预编译，值全部走绑定通道（PLUG-004 §3）
            const [rows] = await c.execute({ sql: req.sqlText, values });
            if (req.readOnly !== false) await c.query("COMMIT");
            const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
            const { rows: out, rowCount } = normalizeRows(list);
            return { rows: out, rowCount, ms: Date.now() - started };
          } catch (e) {
            if (req.readOnly !== false) await c.query("ROLLBACK").catch(() => undefined);
            throw e;
          }
        },
        timeoutMs,
        "查询",
      );
    },
  };
}

export default createPlugin;
