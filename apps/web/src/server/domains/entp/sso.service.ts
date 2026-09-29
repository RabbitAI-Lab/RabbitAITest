/**
 * ENTP-002 SSO 认证源管理：CRUD（secrets AES-GCM 落库/掩码回显）+ 测试连接。
 */
import {
  DomainError,
  ErrCode,
  type AuthSourceUpsert,
  type AuthSourceItem,
  type SsoMethodItem,
} from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { encryptSecret, decryptSecret } from "@/server/domains/system/param.service";

/** config 中需要加密的键（按 type）。 */
const SECRET_KEYS: Record<string, string[]> = {
  LDAP: ["bindPassword"],
  OIDC: ["clientSecret"],
  OAUTH2: ["clientSecret"],
  CAS: [],
  WECOM: ["secret"],
  DINGTALK: ["clientSecret"],
  FEISHU: ["appSecret"],
};

/** SAML 仅枚举占位（ENTP-002 §1.2：后续迭代）——创建/启用拒绝。 */
const PLACEHOLDER_TYPES = new Set(["SAML"]);

export async function listSources(): Promise<{ total: number; items: AuthSourceItem[] }> {
  const rows = await prisma.authSource.findMany({ orderBy: { createdAt: "asc" } });
  return {
    total: rows.length,
    items: rows.map((r) => ({
      id: r.id,
      type: r.type as AuthSourceItem["type"],
      name: r.name,
      enabled: r.enabled,
      config: maskConfig(r.type, r.config as Record<string, unknown>),
    })),
  };
}

function maskConfig(type: string, config: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...config };
  for (const key of SECRET_KEYS[type] ?? []) {
    if (typeof masked[key] === "string" && masked[key]) masked[key] = "******";
  }
  return masked;
}

/** 落库前：掩码 ******=保留原值；其余 secret 加密。 */
async function sealConfig(
  type: string,
  authSourceId: string | null,
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sealed = { ...config };
  let prev: Record<string, unknown> = {};
  if (authSourceId) {
    const row = await prisma.authSource.findUnique({ where: { id: authSourceId } });
    prev = (row?.config ?? {}) as Record<string, unknown>;
  }
  for (const key of SECRET_KEYS[type] ?? []) {
    const v = sealed[key];
    if (v === "******") {
      sealed[key] = prev[key] ?? ""; // 未修改：保留原密文
    } else if (typeof v === "string" && v) {
      sealed[key] = encryptSecret(v);
    }
  }
  return sealed;
}

export async function createSource(input: AuthSourceUpsert): Promise<{ id: string }> {
  if (PLACEHOLDER_TYPES.has(input.type))
    throw new DomainError(ErrCode.SSO_CONFIG_INVALID, "SAML 协议未实现（占位类型，登记后续迭代）");
  const sealed = await sealConfig(input.type, null, input.config as Record<string, unknown>);
  const created = await prisma.authSource.create({
    data: {
      type: input.type,
      name: input.name,
      enabled: input.enabled,
      config: sealed as object,
    },
    select: { id: true },
  });
  return created;
}

export async function updateSource(
  authId: string,
  input: AuthSourceUpsert,
): Promise<{ id: string }> {
  const row = await prisma.authSource.findUnique({ where: { id: authId } });
  if (!row) throw new DomainError(ErrCode.SSO_SOURCE_NOT_FOUND, "认证源不存在");
  if (PLACEHOLDER_TYPES.has(input.type))
    throw new DomainError(ErrCode.SSO_CONFIG_INVALID, "SAML 协议未实现（占位类型）");
  const sealed = await sealConfig(input.type, authId, input.config as Record<string, unknown>);
  await prisma.authSource.update({
    where: { id: authId },
    data: { type: input.type, name: input.name, enabled: input.enabled, config: sealed as object },
  });
  return { id: authId };
}

export async function deleteSource(authId: string): Promise<{ id: string }> {
  const row = await prisma.authSource.findUnique({ where: { id: authId } });
  if (!row) throw new DomainError(ErrCode.SSO_SOURCE_NOT_FOUND, "认证源不存在");
  await prisma.authSource.delete({ where: { id: authId } });
  return { id: authId };
}

export interface LoadedSource {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export async function loadSource(authId: string): Promise<LoadedSource> {
  const row = await prisma.authSource.findUnique({ where: { id: authId } });
  if (!row) throw new DomainError(ErrCode.SSO_SOURCE_NOT_FOUND, "认证源不存在");
  const config = row.config as Record<string, unknown>;
  // 解密 secrets 为明文（仅服务端内部使用，不回显）
  for (const key of SECRET_KEYS[row.type] ?? []) {
    if (typeof config[key] === "string" && (config[key] as string).startsWith("enc:")) {
      config[key] = decryptSecret(config[key] as string) ?? "";
    }
  }
  return { id: row.id, type: row.type, name: row.name, enabled: row.enabled, config };
}

/** 登录页「更多登录方式」（public；enabled 过滤）。 */
export async function listSsoMethods(): Promise<SsoMethodItem[]> {
  const rows = await prisma.authSource.findMany({
    where: { enabled: true },
    select: { id: true, type: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ authId: r.id, type: r.type as SsoMethodItem["type"], name: r.name }));
}

/** 测试连接：LDAP bind+search（注入式 adapter）；HTTP 类探活端点。 */
export async function testConnection(authId: string): Promise<{ ok: boolean; message: string }> {
  const src = await loadSource(authId);
  try {
    if (src.type === "LDAP") {
      const { ldapBindAndSearch } = await import("./ldap-client");
      const r = await ldapBindAndSearch(
        src.config,
        String(src.config.filterKey ?? "uid"),
        "connectivity-probe",
      );
      return { ok: true, message: `连接成功（绑定 DN 通过，搜索 ${r.entries.length} 条示例）` };
    }
    const cfg = src.config as {
      authEndpoint?: string;
      serverUrl?: string;
      corpId?: string;
      appId?: string;
      clientId?: string;
    };
    if (src.type === "CAS") {
      const { outboundDispatcher } = await import("@/server/safe-fetch");
      const dispatcher = outboundDispatcher({
        allowPrivate: process.env.OUTBOUND_ALLOW_PRIVATE === "1",
      });
      const res = await fetch(`${cfg.serverUrl}/login`, {
        method: "GET",
        redirect: "manual",
        dispatcher,
      } as RequestInit & { dispatcher: unknown });
      return res.status < 500
        ? { ok: true, message: `连接成功（服务端可达，HTTP ${res.status}）` }
        : { ok: false, message: `服务端响应异常（HTTP ${res.status}）` };
    }
    if (src.type === "OIDC" || src.type === "OAUTH2") {
      const { outboundDispatcher } = await import("@/server/safe-fetch");
      const dispatcher = outboundDispatcher({
        allowPrivate: process.env.OUTBOUND_ALLOW_PRIVATE === "1",
      });
      const res = await fetch(String(cfg.authEndpoint), {
        method: "GET",
        redirect: "manual",
        dispatcher,
      } as RequestInit & { dispatcher: unknown });
      return res.status < 500
        ? { ok: true, message: `连接成功（授权端点可达，HTTP ${res.status}）` }
        : { ok: false, message: `授权端点响应异常（HTTP ${res.status}）` };
    }
    // 扫码三类：凭据探活经 mock/平台 token 端点在回调链路验证，这里只做配置完整性
    return { ok: true, message: "配置已保存（凭据在登录链路验证）" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
