/**
 * web 侧出站 URL 守卫（API-011 §1.2 / rules/security.md SSRF 边界）：
 * 仅 http(s)；解析 DNS 后阻断环回/私网/链路本地/云元数据段。
 * env OUTBOUND_ALLOW_PRIVATE=1 放开私网与环回（e2e/CI mock 与自建内网 Swagger 场景——部署口径文档注明）。
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { DomainError, ErrCode } from "@rabbit/shared";

function allowPrivate(): boolean {
  return process.env.OUTBOUND_ALLOW_PRIVATE === "1";
}

function ipBlocked(ip: string): boolean {
  if (ip === "::1" || ip.startsWith("127.") || ip.startsWith("169.254.") || ip.startsWith("0.")) return true;
  if (ip.startsWith("::ffff:")) return ipBlocked(ip.slice(7));
  if (ip.startsWith("fe80:") || ip === "fd00::0") return true;
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && ip.endsWith(".2")) return true; // AS 私网段
  return false;
}

/** 校验出站 URL：协议白名单 + 解析全部 A/AAAA 记录后 IP 黑名单（防 DNS rebinding 的解析期校验口径） */
export async function assertSafeOutboundUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DomainError(ErrCode.SWAGGER_SYNC_URL_BLOCKED, "URL 非法");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DomainError(ErrCode.SWAGGER_SYNC_URL_BLOCKED, "仅允许 http(s) URL");
  }
  if (allowPrivate()) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (ipBlocked(host)) throw blocked(host);
    return;
  }
  const records = await lookup(host, { all: true }).catch(() => []);
  if (records.length === 0) throw new DomainError(ErrCode.SWAGGER_FETCH_FAILED, "域名解析失败");
  for (const r of records) {
    if (ipBlocked(r.address)) throw blocked(r.address);
  }
}

function blocked(ip: string): DomainError {
  return new DomainError(ErrCode.SWAGGER_SYNC_URL_BLOCKED, `目标地址不允许（内网/环回/元数据段：${ip}）`);
}
