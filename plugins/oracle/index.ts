/**
 * oracle 驱动插件（PLUG-004）：oracledb 7（Oracle 官方 node-oracledb，Apache-2.0/UPL，
 * thin 模式纯 JS；npm 官方 registry——来源铁律 PLUG-004 §0）。
 * 占位符归一化 `?` → `:1,:2…`（oracledb 位置绑定）；行=数组+metaData → zipRows（列名小写）。
 * 只读防线：词法白名单 + SET TRANSACTION READ ONLY + 连接即关。
 */
import type { DriverPlugin } from "@rabbit/shared";
import {
  parseDbUrl,
  replaceQuestionPlaceholders,
  zipRows,
  friendlyDbError,
  raceTimeout,
} from "../../packages/shared/src/plugins/driver-kit";
import oracledb from "oracledb";

const CONNECT_TIMEOUT_MS = 3000;
const QUERY_TIMEOUT_MS = 10_000;

async function withConnection<T>(
  url: string,
  fn: (conn: oracledb.Connection) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const parsed = parseDbUrl(url, "oracle");
  let conn: oracledb.Connection | null = null;
  try {
    conn = await oracledb.getConnection({
      user: parsed.user,
      password: parsed.password,
      connectString: `${parsed.host}:${parsed.port}/${parsed.path}`,
    });
    conn.callTimeout = timeoutMs;
    return await raceTimeout(fn(conn), timeoutMs, label);
  } catch (e) {
    throw new Error(friendlyDbError(e, parsed.redacted));
  } finally {
    await conn?.close().catch(() => undefined);
  }
}

export function createPlugin(): DriverPlugin {
  return {
    driver: "oracle",
    async testConnection({ url }) {
      await withConnection(
        url,
        async (c) => {
          await c.execute("SELECT 1 FROM DUAL");
        },
        CONNECT_TIMEOUT_MS + 2000,
        "连接",
      );
    },
    async query({ url }, req) {
      const started = Date.now();
      const timeoutMs = req.timeoutMs ?? QUERY_TIMEOUT_MS;
      const { sql, count } = replaceQuestionPlaceholders(req.sqlText, "colon");
      if (count !== req.params.length) {
        throw new Error(`占位符数量（${count}）与绑定参数数量（${req.params.length}）不一致`);
      }
      const values = req.params.map((p) => p.value ?? null);
      return withConnection(
        url,
        async (c) => {
          if (req.readOnly !== false) await c.execute("SET TRANSACTION READ ONLY");
          try {
            const res = await c.execute(sql, values, { maxRows: 10_000 });
            if (req.readOnly !== false) await c.execute("COMMIT");
            const { rows, rowCount } = zipRows(
              (res.rows ?? []) as unknown[][],
              (res.metaData ?? []).map((m) => ({ name: m.name })),
            );
            return { rows, rowCount, ms: Date.now() - started };
          } catch (e) {
            if (req.readOnly !== false) await c.execute("ROLLBACK").catch(() => undefined);
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
