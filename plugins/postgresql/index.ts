/**
 * postgresql 驱动插件（PLUG-004）：pg 8（node-postgres，MIT，npm 官方 registry——
 * 驱动来源铁律见 PLUG-004 §0，禁用飞致云再分发包）。
 * 执行面 engine in-process / 管理面 plugin-runner testConnection。
 * 只读防线：调用方词法白名单（assertReadOnlySelect）+ 本插件 BEGIN READ ONLY 事务 + 连接即关。
 */
import type { DriverPlugin } from "@rabbit/shared";
import {
  parseDbUrl,
  replaceQuestionPlaceholders,
  normalizeRows,
  friendlyDbError,
  raceTimeout,
} from "../../packages/shared/src/plugins/driver-kit";
import pg from "pg";

const CONNECT_TIMEOUT_MS = 3000;
const QUERY_TIMEOUT_MS = 10_000;

async function withClient<T>(
  url: string,
  fn: (client: pg.Client) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const parsed = parseDbUrl(url, "postgresql");
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: timeoutMs,
    query_timeout: timeoutMs,
  });
  try {
    await raceTimeout(client.connect(), timeoutMs, label);
    return await fn(client);
  } catch (e) {
    throw new Error(friendlyDbError(e, parsed.redacted));
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function createPlugin(): DriverPlugin {
  return {
    driver: "postgresql",
    async testConnection({ url }) {
      await withClient(
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
      const { sql, count } = replaceQuestionPlaceholders(req.sqlText, "dollar");
      if (count !== req.params.length) {
        throw new Error(`占位符数量（${count}）与绑定参数数量（${req.params.length}）不一致`);
      }
      const values = req.params.map((p) => p.value ?? null);
      return withClient(
        url,
        async (c) => {
          if (req.readOnly !== false) await c.query("BEGIN READ ONLY");
          try {
            const res = await c.query({ text: sql, values });
            if (req.readOnly !== false) await c.query("COMMIT");
            const { rows, rowCount } = normalizeRows(res.rows);
            return { rows, rowCount, ms: Date.now() - started };
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
