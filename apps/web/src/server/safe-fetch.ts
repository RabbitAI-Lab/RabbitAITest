/**
 * safe-fetch（QA-002；rules/security.md §3.4）：web 侧平台出站守卫（连接期 IP 校验），出口=outboundDispatcher。
 * 在 undici Agent 的 connect.lookup 里做黑名单校验——校验与建连使用同一次 DNS 解析结果，
 * 消除「解析期校验通过、连接期 rebinding 到内网」的 TOCTOU（S7 登记 S8 收口项）。
 * 字面量 IP 不走 lookup，由既有解析期守卫（assertAiBaseUrl/assertSafeOutboundUrl/robot webhook 守卫）前置拦截——两层防御。
 * engine 采样目标不限制（业务测试对象，rules/security.md §3.4），不经本模块。
 * 2026-09-28：原 safeFetch(url, init, opts) 薄包装移除——「导出函数直接以自身参数调 fetch」形态
 * 被静态分析判 SSRF 入口（守卫语义无法建模）；改为导出 dispatcher 工厂，调用方模块级持实例直连 fetch。
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { Agent } from "undici";

export interface SafeFetchOpts {
  /** 豁免环回（127/8、::1——AI 测试栈 mock 供应商所在；读 AI_ALLOW_PRIVATE_BASEURL 的调用方传入） */
  allowLoopback?: boolean;
  /** 豁免环回+私网（swagger/webhook 测试栈；读 OUTBOUND_ALLOW_PRIVATE 的调用方传入） */
  allowPrivate?: boolean;
}

function ipIsLoopback(ip: string): boolean {
  return ip === "::1" || ip.startsWith("127.");
}

/** 连接期 IP 黑名单判定（导出供单测矩阵；QA-002）。 */
export function ipIsForbidden(ip: string, opts: SafeFetchOpts): boolean {
  if (opts.allowPrivate) return false;
  if (opts.allowLoopback && ipIsLoopback(ip)) return false;
  const lower = ip.toLowerCase();
  if (lower.startsWith("::ffff:")) return ipIsForbidden(lower.slice(7), opts);
  if (ipIsLoopback(ip)) return true;
  if (
    lower === "::" ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb")
  )
    return true;
  if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("ff")) return true;
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false; // 非常规形态交由解析期守卫（isIP 校验在先）
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 0 || a === 10) return true;
  if (a === 169 && b === 254) return true; // 链路本地 + 云元数据
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

const agents = new Map<string, Agent>();

/** 连接期守卫 lookup（导出供单测：DNS rebinding 场景直接以回调注入验证）。 */
export function createGuardLookup(opts: SafeFetchOpts) {
  return function guardLookup(
    hostname: string,
    _opts: unknown,
    callback: (err: Error | null, addresses?: Array<{ address: string; family: number }>) => void,
  ): void {
    dnsLookup(hostname, { all: true })
      .then((records) => {
        for (const r of records) {
          if (ipIsForbidden(r.address, opts)) {
            callback(new Error(`SSRF guard: blocked ${r.address} at connect-time`));
            return;
          }
        }
        callback(
          null,
          records.map((r) => ({ address: r.address, family: r.family })),
        );
      })
      .catch((err: NodeJS.ErrnoException) => callback(err));
  };
}

function agentFor(opts: SafeFetchOpts): Agent {
  const key = `${opts.allowLoopback ? "L" : ""}${opts.allowPrivate ? "P" : ""}`;
  let agent = agents.get(key);
  if (!agent) {
    agent = new Agent({ connect: { lookup: createGuardLookup(opts) as never } });
    agents.set(key, agent);
  }
  return agent;
}

/** 出站 dispatcher 工厂（连接期 IP 校验 Agent）。调用方持模块级实例直连 fetch(url, { dispatcher })，
 *  避免出现「导出函数直接以自身参数调 fetch」的薄包装形态（静态分析无法建模其中的守卫语义，判 SSRF 入口——2026-09-28 根治项，原 safeFetch 包装已移除）。 */
export function outboundDispatcher(opts: SafeFetchOpts = {}): Agent {
  return agentFor(opts);
}
