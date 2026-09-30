/**
 * INFRA-008：采样器/步骤错误分类器（错误码枚举=规格 §2.1 契约冻结点）。
 * 任务级 failureKind 语义不变（NETWORK_ERROR 等），code 是步骤级细化，二者并存。
 * 遍历 cause 链（≤5 层）收集 code/name 后正则归类；长尾显式落 other_net，不虚造细类。
 */
export type SamplerErrorCode =
  | "dns"
  | "connect"
  | "reset"
  | "tls"
  | "timeout"
  | "url"
  | "aborted"
  | "other_net"
  | "unknown";

export function classifySamplerError(err: unknown): SamplerErrorCode {
  if (err === null || err === undefined) return "unknown";
  const codes: string[] = [];
  const names: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; cur instanceof Error && depth < 5; depth++) {
    const e = cur as Error & { code?: unknown };
    if (e.code !== undefined && e.code !== null) codes.push(String(e.code));
    names.push(e.name);
    cur = (e as { cause?: unknown }).cause;
  }
  if (names.length === 0 && typeof err === "string") {
    // 非 Error 抛出物：按文本归类（兜底 unknown）
    codes.push(err);
  }
  const hay = `${codes.join(" ")} ${names.join(" ")}`.toLowerCase();
  if (/enotfound|eai_again|eai_noname/.test(hay)) return "dns";
  if (/econnrefused|enetunreach|ehostunreach/.test(hay)) return "connect";
  if (/econnreset|epipe/.test(hay)) return "reset";
  if (/tls|ssl|cert|leaf_signature|self_signed/.test(hay)) return "tls";
  if (/timeout|etimedout/.test(hay)) return "timeout";
  if (/invalid url|urierror|invalidargument/.test(hay)) return "url";
  if (/abort/.test(hay)) return "aborted";
  if (err instanceof TypeError) return "url"; // new URL()/undici 参数非法多表现为 TypeError
  return "other_net";
}
