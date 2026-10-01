/**
 * SCM-001 OAuth 应用双层配置：组织覆盖（scm_org_apps，credential-crypto AES-GCM）> SystemParam group=scm。
 * 组织级只能增删自己的覆盖，不能修改系统级配置（权限隔离在 route 层：SYSTEM_PARAM:UPDATE vs ORG_INTEGRATION:UPDATE）。
 */
import {
  DomainError,
  ErrCode,
  SCM_OAUTH_PROVIDERS,
  resolveScmBases,
  scmEnvOverrideKey,
  type ScmOauthProvider,
  type ScmParamValue,
} from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import {
  decryptCredential,
  encryptCredential,
  integrationSecretConfigured,
} from "@/server/domains/api/credential-crypto";
import { decryptSecret, readParam } from "@/server/domains/system/param.service";
import type { ScmOrgAppUpsertInput } from "@rabbit/shared";

/** 解析后的生效配置（source=none 时其余字段为空；clientSecret 供 OAuth 流服务端用，永不回显） */
export interface ScmAppResolved {
  source: "org" | "system" | "none";
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  enabled: boolean;
}

const EMPTY: ScmAppResolved = {
  source: "none",
  clientId: "",
  clientSecret: "",
  baseUrl: "",
  enabled: false,
};

function appOrgSecretNamespace(provider: ScmOauthProvider): string {
  return `scm-app:${provider}`;
}

/** 双层继承解析：组织覆盖（enabled 且 clientId 非空）→ 系统级 → none。 */
export async function resolveScmApp(
  orgId: string,
  provider: ScmOauthProvider,
): Promise<ScmAppResolved> {
  const orgRow = await prisma.scmOrgApp.findUnique({
    where: { orgId_provider: { orgId, provider } },
  });
  if (orgRow?.clientId && orgRow.enabled) {
    return {
      source: "org",
      clientId: orgRow.clientId,
      clientSecret: decryptCredential(appOrgSecretNamespace(provider), orgRow.clientSecret),
      baseUrl: orgRow.baseUrl ?? "",
      enabled: true,
    };
  }
  const params = (await readParam("scm")) as unknown as Record<string, unknown>;
  const v = (params[provider] ?? {}) as Record<string, unknown>;
  const clientId = String(v.clientId ?? "");
  if (clientId && v.enabled === true) {
    const stored = String(v.clientSecret ?? "");
    const clientSecret = stored.startsWith("enc:") ? (decryptSecret(stored) ?? "") : stored;
    return {
      source: "system",
      clientId,
      clientSecret,
      baseUrl: String(v.baseUrl ?? ""),
      enabled: true,
    };
  }
  return { ...EMPTY };
}

/** OAuth 流使用的生效端点基址（测试栈 env 覆盖 > GitLab 实例地址 > 官方域）。 */
export async function effectiveScmBases(orgId: string, provider: ScmOauthProvider) {
  const app = await resolveScmApp(orgId, provider);
  return {
    app,
    bases: resolveScmBases(provider, {
      appBaseUrl: app.baseUrl,
      envBase: process.env[scmEnvOverrideKey(provider)] ?? null,
    }),
  };
}

/** GET 视图（三平台齐备；clientSecret 只回 hasSecret） */
export async function listScmApps(orgId: string) {
  const out: {
    provider: ScmOauthProvider;
    source: "org" | "system" | "none";
    clientId: string;
    hasSecret: boolean;
    baseUrl: string;
    enabled: boolean;
  }[] = [];
  for (const provider of SCM_OAUTH_PROVIDERS) {
    const r = await resolveScmApp(orgId, provider);
    out.push({
      provider,
      source: r.source,
      clientId: r.source === "none" ? "" : r.clientId,
      hasSecret: Boolean(r.clientSecret),
      baseUrl: r.baseUrl,
      enabled: r.enabled,
    });
  }
  return { total: out.length, items: out };
}

/** 组织级覆盖保存（clientId 必填非空；clientSecret 留空=沿用已存密文） */
export async function upsertScmOrgApp(
  orgId: string,
  provider: ScmOauthProvider,
  input: ScmOrgAppUpsertInput,
) {
  const existing = await prisma.scmOrgApp.findUnique({
    where: { orgId_provider: { orgId, provider } },
  });
  let secretEnc = existing?.clientSecret ?? "";
  if (input.clientSecret && input.clientSecret !== "******") {
    if (!integrationSecretConfigured()) {
      throw new DomainError(
        ErrCode.INTEGRATION_SECRET_MISSING,
        "集成加密密钥未配置（RABBIT_INTEGRATION_SECRET）",
      );
    }
    secretEnc = encryptCredential(appOrgSecretNamespace(provider), input.clientSecret);
  }
  const row = await prisma.scmOrgApp.upsert({
    where: { orgId_provider: { orgId, provider } },
    update: {
      clientId: input.clientId,
      baseUrl: input.baseUrl ?? "",
      enabled: input.enabled,
      ...(input.clientSecret && input.clientSecret !== "******" ? { clientSecret: secretEnc } : {}),
    },
    create: {
      orgId,
      provider,
      clientId: input.clientId,
      clientSecret: secretEnc,
      baseUrl: input.baseUrl ?? "",
      enabled: input.enabled,
    },
  });
  return { provider: row.provider, clientId: row.clientId, hasSecret: Boolean(row.clientSecret) };
}

/** 撤销组织覆盖 → 回落继承系统级 */
export async function deleteScmOrgApp(orgId: string, provider: ScmOauthProvider) {
  await prisma.scmOrgApp.deleteMany({ where: { orgId, provider } });
  return { provider };
}
