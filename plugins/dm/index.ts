/**
 * dm 驱动插件（PLUG-004）：dmdb 1.0.x（达梦官方 Node 驱动，纯 JS；npm 发布方
 * dameng_database <ztn@dameng.com>，许可=包内 LICENSE——来源铁律 PLUG-004 §0）。
 * API 与 oracledb 同构；占位符原生 `?`（dmdb d.ts 示例实证）；行=数组+metaData → zipRows。
 * 只读防线：词法白名单 + SET TRANSACTION READ ONLY + 连接即关。
 */
import type { DriverPlugin } from "../../packages/shared/src/plugins/spi";
import {
  parseDbUrl,
  zipRows,
  friendlyDbError,
  raceTimeout,
} from "../../packages/shared/src/plugins/driver-kit";
import dmdb from "dmdb";

const CONNECT_TIMEOUT_MS = 3000;
const QUERY_TIMEOUT_MS = 10_000;

interface DmResult {
  rows?: unknown[][];
  metaData?: Array<{ name: string }>;
}

interface DmConn {
  execute: (sql: string, params?: unknown[]) => Promise<DmResult>;
  close: () => Promise<void>;
}

async function withConnection<T>(
  url: string,
  fn: (conn: DmConn) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const parsed = parseDbUrl(url, "dm");
  let conn: DmConn | null = null;
  try {
    conn = (await dmdb.getConnection({
      user: parsed.user,
      password: parsed.password,
      connectString: `${parsed.host}:${parsed.port}`,
    })) as unknown as DmConn;
    return await raceTimeout(fn(conn), timeoutMs, label);
  } catch (e) {
    throw new Error(friendlyDbError(e, parsed.redacted));
  } finally {
    await conn?.close().catch(() => undefined);
  }
}

export function createPlugin(): DriverPlugin {
  return {
    driver: "dm",
    async testConnection({ url }) {
      await withConnection(
        url,
        async (c) => {
          await c.execute("SELECT 1");
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
        throw new Error(`占位符数量（${placeholders}）与绑定参数数量（${req.params.length}）不一致`);
      }
      const values = req.params.map((p) => p.value ?? null);
      return withConnection(
        url,
        async (c) => {
          if (req.readOnly !== false) await c.execute("SET TRANSACTION READ ONLY");
          try {
            const res = await c.execute(req.sqlText, values);
            if (req.readOnly !== false) await c.execute("COMMIT");
            const { rows, rowCount } = zipRows(res.rows ?? [], res.metaData ?? []);
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
