/**
 * SQL 处理器只读词法白名单（PLUG-004 §2.3；API-006 §2 冻结方案落地）。
 * 与各驱动的 READ ONLY 事务构成两层防线；本守卫只做词法判定，不改写、不拼装任何 SQL。
 * 判定基线：剥除注释与字符串字面量后的文本——首词须 SELECT/WITH、无多余分号、
 * 词边界禁 INTO / FOR UPDATE / FOR SHARE。
 */
import { ErrCode } from "../envelope";

export class SqlGuardError extends Error {
  readonly code: number;
  constructor(message: string, code = ErrCode.SQL_NOT_SELECT) {
    super(message);
    this.name = "SqlGuardError";
    this.code = code;
  }
}

/** 禁用的写/锁语义 token（词边界匹配，大小写不敏感；空格=任意空白） */
const FORBIDDEN_TOKENS = ["into", "for update", "for share"] as const;

/** 剥除 `--` 行注释、`/* ... *​/` 块注释与 '...'/"..."/`...` 字面量（判定用，不改写原语句） */
export function stripForGuard(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, " '' ")
    .replace(/"(?:[^"\\]|\\.)*"/g, ' "" ')
    .replace(/`(?:[^`\\]|\\.)*`/g, " `` ");
}

/** 单条只读 SELECT/WITH 校验；非法抛 SqlGuardError（code=SQL_NOT_SELECT 50031） */
export function assertReadOnlySelect(sql: string): void {
  const raw = sql.trim();
  if (raw.length === 0) throw new SqlGuardError("SQL 语句为空");
  // 分号规则作用于原文：剥掉末尾分号后不得再出现（多条语句/注释内分号一律拒绝）
  const noTrailing = raw.replace(/(?:\s*;)+\s*$/, "");
  if (noTrailing.includes(";")) {
    throw new SqlGuardError("仅允许单条语句（检测到多个分号）");
  }
  const stripped = stripForGuard(raw);
  if (stripped.includes("/*")) throw new SqlGuardError("存在未闭合的块注释");
  const head = stripped.trimStart().toUpperCase();
  if (!/^SELECT[\s(]/.test(head) && !/^WITH[\s(]/.test(head) && head !== "SELECT" && head !== "WITH") {
    throw new SqlGuardError("SQL 语句必须以 SELECT/WITH 开头（只读白名单）");
  }
  for (const token of FORBIDDEN_TOKENS) {
    const re = new RegExp(`\\b${token.replace(/ /g, "\\s+")}\\b`, "i");
    if (re.test(stripped)) {
      throw new SqlGuardError(`只读白名单禁用：${token.toUpperCase()}`);
    }
  }
}
