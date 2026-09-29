/** AI baseUrl SSRF 守卫（AI-001 §2；rules/security.md）：禁内网/环回/链路本地/云元数据/通配。
 * 例外：AI_ALLOW_PRIVATE_BASEURL=1 仅豁免**环回**（127/8、::1、localhost——测试栈 mock 供应商所在）；
 * 私网段/链路本地/云元数据**始终拦截**（守卫用例在任何环境可测）。
 * 残余风险登记（S7 规格 §8）：DNS rebinding（resolve 后校验，未做连接期固定 IP）→ S8 QA-002 收口。 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { DomainError, ErrCode } from "@rabbit/shared";

function ipIsLoopback(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (ip.startsWith("127.") || lower === "::1") return true;
  return false;
}

function ipIsForbidden(ip: string): boolean {
  const v4 = ip.split(".").map(Number);
  const isV4 = v4.length === 4 && v4.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
  if (isV4) {
    const [a, b] = [v4[0]!, v4[1]!];
    if (a === 0 || a === 10 || a === 127) return true; // 0.0.0.0/8、10/8、环回
    if (a === 169 && b === 254) return true; // 链路本地 + 云元数据 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb")
  )
    return true; // fe80::/10 链路本地
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 ULA
  if (lower.startsWith("ff")) return true; // 组播
  return false;
}

function assertIp(ip: string): void {
  // 测试栈开关只豁免环回（mock 供应商）；私网/元数据始终拦截
  if (process.env.AI_ALLOW_PRIVATE_BASEURL === "1" && ipIsLoopback(ip)) return;
  if (ipIsForbidden(ip)) {
    throw new DomainError(
      ErrCode.AI_BASEURL_FORBIDDEN,
      `BaseUrl 指向受限地址 ${ip}（内网/环回/云元数据段被拒绝）`,
    );
  }
}

/** 校验 baseUrl：解析失败/受限 host → 422 70422；字面 IP 直检 + 域名 DNS resolve 后全 IP 复检。 */
export async function assertAiBaseUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DomainError(ErrCode.AI_BASEURL_FORBIDDEN, "BaseUrl 不是合法 URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DomainError(ErrCode.AI_BASEURL_FORBIDDEN, "BaseUrl 协议仅支持 http/https");
  }
  const host = url.hostname.replace(/^\[|\]$/g, ""); // IPv6 字面量去括号
  if (isIP(host)) {
    assertIp(host);
    return;
  }
  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new DomainError(ErrCode.AI_BASEURL_FORBIDDEN, `BaseUrl 域名无法解析：${host}`);
  }
  for (const { address } of records) assertIp(address);
}
