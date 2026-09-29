/**
 * 驱动插件公共工具（PLUG-004 §2.2）：五家驱动元数据 / URL 解析 / ? 占位符归一化 /
 * 行与值归一化 / 错误友好化。
 *
 * 消费方两路：web/shared 走 @rabbit/shared 正常导出（校验与 UI 元数据）；
 * 五个驱动插件经相对路径 import 后由 esbuild 内联进 tarball——**本文件禁止引入
 * zod 等运行时依赖**（插件自包含纪律，PLUG-001 口径延续）。
 */

export const DRIVERS = ["postgresql", "mysql", "oracle", "sqlserver", "dm"] as const;
export type Driver = (typeof DRIVERS)[number];

/** 占位符归一化目标风格（书写统一 MySQL 风格 ?，见 replaceQuestionPlaceholders） */
export type ParamStyle = "dollar" | "colon" | "at" | "question";

export interface DriverMeta {
  label: string;
  defaultPort: number;
  urlPlaceholder: string;
  urlRegex: RegExp;
  paramStyle: ParamStyle;
}

export const DRIVER_META: Record<Driver, DriverMeta> = {
  postgresql: {
    label: "PostgreSQL",
    defaultPort: 5432,
    urlPlaceholder: "postgresql://user:pass@host:5432/db",
    urlRegex: /^postgresql:\/\//,
    paramStyle: "dollar",
  },
  mysql: {
    label: "MySQL",
    defaultPort: 3306,
    urlPlaceholder: "mysql://user:pass@host:3306/db",
    urlRegex: /^mysql:\/\//,
    paramStyle: "question",
  },
  oracle: {
    label: "Oracle",
    defaultPort: 1521,
    urlPlaceholder: "oracle://user:pass@host:1521/service",
    urlRegex: /^oracle:\/\//,
    paramStyle: "colon",
  },
  sqlserver: {
    label: "SQL Server",
    defaultPort: 1433,
    urlPlaceholder: "sqlserver://user:pass@host:1433/db",
    urlRegex: /^sqlserver:\/\//,
    paramStyle: "at",
  },
  dm: {
    label: "达梦 DM",
    defaultPort: 5236,
    urlPlaceholder: "dm://user:pass@host:5236",
    urlRegex: /^dm:\/\//,
    paramStyle: "colon",
  },
};

export function isDriver(v: unknown): v is Driver {
  return typeof v === "string" && (DRIVERS as readonly string[]).includes(v);
}

export interface ParsedDbUrl {
  user?: string;
  password?: string;
  host: string;
  port: number;
  /** path 去首斜杠（Oracle=服务名；PG/MySQL/SQLServer=库名；DM 通常为空） */
  path: string;
  params: URLSearchParams;
  /** 日志安全形态（不含凭据） */
  redacted: string;
}

/** 数据源 URL 解析（scheme 白名单 + 默认端口回填；不校验连通性） */
export function parseDbUrl(url: string, driver: Driver): ParsedDbUrl {
  const meta = DRIVER_META[driver];
  if (!meta.urlRegex.test(url)) {
    throw new Error(`数据源 URL 须以 ${driver}:// 开头`);
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("数据源 URL 非法");
  }
  if (!u.hostname) throw new Error("数据源 URL 缺少主机名");
  const port = u.port ? Number(u.port) : meta.defaultPort;
  const user = u.username ? decodeURIComponent(u.username) : undefined;
  const password = u.password ? decodeURIComponent(u.password) : undefined;
  return {
    user,
    password,
    host: u.hostname,
    port,
    path: decodeURIComponent(u.pathname.replace(/^\//, "")),
    params: u.searchParams,
    redacted: `${driver}://${u.hostname}:${port}`,
  };
}

/**
 * 将 MySQL 风格 ? 占位符替换为原生绑定 token（PLUG-004 §3：只做 token 替换，
 * 跳过字符串字面量/标识符/注释，**替换产物不掺入任何外部输入**——值一律走驱动绑定通道）。
 */
export function replaceQuestionPlaceholders(
  sql: string,
  style: ParamStyle,
): { sql: string; count: number } {
  let out = "";
  let i = 0;
  let n = 0;
  const copyLiteral = (quote: string): number => {
    let j = i + 1;
    while (j < sql.length) {
      if (sql[j] === "\\") {
        j += 2;
        continue;
      }
      if (sql[j] === quote) return j + 1;
      j += 1;
    }
    return sql.length;
  };
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const end = copyLiteral(ch);
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "?") {
      n += 1;
      if (style === "dollar") out += `$${n}`;
      else if (style === "colon") out += `:${n}`;
      else if (style === "at") out += `@p${n - 1}`;
      else out += "?";
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return { sql: out, count: n };
}

/** 驱动返回值 → 报告安全基元（Date→ISO；Buffer/TypedArray→base64；其余 JSON 序列化） */
export function normalizeDbValue(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) return v.toString("base64");
  if (ArrayBuffer.isView(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

export type NormalizedRow = Record<string, string | number | boolean | null>;

/** 对象行归一化（pg/mysql2/mssql 形态）+ 行数上限截断 */
export function normalizeRows(
  rows: Array<Record<string, unknown>>,
  maxRows = 100,
): { rows: NormalizedRow[]; rowCount: number } {
  const rowCount = rows.length;
  return {
    rows: rows.slice(0, maxRows).map((r) => {
      const out: NormalizedRow = {};
      for (const [k, v] of Object.entries(r)) out[k] = normalizeDbValue(v);
      return out;
    }),
    rowCount,
  };
}

/** 数组行+列名（oracledb/dmdb 形态）→ 对象行归一化 */
export function zipRows(
  arrays: unknown[][],
  columns: Array<{ name: string }>,
  maxRows = 100,
): { rows: NormalizedRow[]; rowCount: number } {
  const rowCount = arrays.length;
  return {
    rows: arrays.slice(0, maxRows).map((arr) => {
      const out: NormalizedRow = {};
      columns.forEach((c, idx) => {
        out[c.name.toLowerCase()] = normalizeDbValue(arr[idx]);
      });
      return out;
    }),
    rowCount,
  };
}

/** 连接类错误 → 中文可读信息（target=不含凭据的 host:port 形态） */
export function friendlyDbError(err: unknown, target: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED/.test(msg)) return `连接被拒绝（${target}）——检查主机/端口与防火墙`;
  if (/ETIMEDOUT|EAI_AGAIN/i.test(msg)) return `连接超时或网络不可达（${target}）`;
  if (/ENOTFOUND/.test(msg)) return `主机名解析失败（${target}）`;
  if (/ECONNRESET/.test(msg)) return `连接被重置（${target}）`;
  // NJS-503（oracledb）/ tedious（mssql）把拒绝表现为 could not be established / Could not connect
  if (/could not be established|could not connect|failed to connect/i.test(msg)) {
    return `连接失败（${target}）——检查主机/端口与服务可达性`;
  }
  if (/authentication|password|login failed|登录失败|ORA-01017|28000|invalid username/i.test(msg)) {
    return `认证失败（${target}）——检查用户名/密码`;
  }
  return msg;
}

/** Promise 超时竞速（到点抛错；连接资源的销毁由调用方 finally 负责） */
export async function raceTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
