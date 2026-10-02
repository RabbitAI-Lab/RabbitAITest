/**
 * 协议插件公共工具（PLUG-005 §2.1）：bodyText 截断 / host:port 解析 / 网络错误友好化。
 * 与 driver-kit（PLUG-004）同模式：插件构建期内联进 tarball、单测直接消费；
 * 禁止引入 zod 等运行时依赖（插件自包含纪律）。
 * raceTimeout 复用 driver-kit 实现（单一来源，避免双定义——TS2308 教训）。
 */

export { raceTimeout } from "./driver-kit";

/** SamplerResult bodyText ≤4KB 约束（SPI 契约）；截断时附原始长度标记 */
export function truncateBody(text: string, max = 4096): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…[截断，原 ${text.length} 字符]`;
}

export interface HostPort {
  host: string;
  port: number;
}

/** host:port 解析（host 必填、端口 1-65535 默认回填） */
export function parseHostPort(
  host: string,
  port: number | undefined,
  defaultPort: number,
): HostPort {
  if (typeof host !== "string" || host.trim().length === 0) {
    throw new Error("host 必填");
  }
  const p = port ?? defaultPort;
  if (!Number.isInteger(p) || p < 1 || p > 65535) {
    throw new Error(`端口须为 1-65535 整数（当前 ${p}）`);
  }
  return { host: host.trim(), port: p };
}

/** 连接类错误 → 中文可读信息（target 不含凭据） */
export function friendlyNetError(err: unknown, target: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED/.test(msg)) return `连接被拒绝（${target}）——检查主机/端口与服务状态`;
  if (/ETIMEDOUT|EAI_AGAIN/i.test(msg)) return `连接超时或网络不可达（${target}）`;
  if (/ENOTFOUND/.test(msg)) return `主机名解析失败（${target}）`;
  if (/ECONNRESET/.test(msg)) return `连接被重置（${target}）`;
  if (/EHOSTUNREACH|ENETUNREACH/.test(msg)) return `主机/网络不可达（${target}）`;
  if (/authentication failed|access denied|permission denied|认证失败/i.test(msg)) {
    return `认证失败（${target}）——检查用户名/凭据`;
  }
  return msg;
}
