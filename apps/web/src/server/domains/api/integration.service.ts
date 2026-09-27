/**
 * 组织服务集成（INTG-001/002 §2）：PlatformIntegration CRUD + 凭据加密 + 测试连接（经 runner 平台插件）。
 */
import { DomainError, ErrCode, integrationSaveSchema, PLATFORM_META } from "@rabbit/shared";
import type { PlatformConfig } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { encryptCredential, decryptCredential, integrationSecretConfigured } from "./credential-crypto";
import { enabledPlatformPluginId } from "./plugin.service";
import { runnerCall } from "@/server/plugin-runner.client";

type SaveInput = ReturnType<typeof integrationSaveSchema.parse>;

function toConfig(row: { address: string; authType: string; credential: string; platform: string }): PlatformConfig {
  const plain = decryptCredential(row.platform, row.credential);
  const parsed = JSON.parse(plain) as PlatformConfig;
  return { ...parsed, address: row.address, authType: row.authType as PlatformConfig["authType"] };
}

export async function listIntegrations(orgId: string) {
  const rows = await prisma.platformIntegration.findMany({ where: { orgId } });
  const byPlatform = new Map(rows.map((r) => [r.platform, r]));
  // 三平台全返回（未配置=NONE 态，前端卡片需要）
  return (Object.keys(PLATFORM_META) as Array<keyof typeof PLATFORM_META>).map((platform) => {
    const r = byPlatform.get(platform);
    return {
      platform,
      address: r?.address ?? "",
      authType: r?.authType ?? PLATFORM_META[platform].authTypeFixed ?? "BASIC",
      hasCredential: Boolean(r),
      testStatus: r?.testStatus ?? "NONE",
      testMessage: r?.testMessage ?? null,
      testedAt: r?.testedAt?.toISOString() ?? null,
      updatedAt: (r?.updatedAt ?? new Date(0)).toISOString(),
    };
  });
}

export async function saveIntegration(orgId: string, input: SaveInput): Promise<void> {
  if (!integrationSecretConfigured()) {
    throw new DomainError(ErrCode.INTEGRATION_SECRET_MISSING, "RABBIT_INTEGRATION_SECRET 未配置（≥32 字符），无法保存集成凭据");
  }
  const meta = PLATFORM_META[input.platform];
  let authType = input.authType;
  if (meta.authTypeFixed) authType = meta.authTypeFixed;
  const credential: PlatformConfig = {
    address: input.address,
    authType,
    ...(input.username !== undefined ? { username: input.username } : {}),
    ...(input.password !== undefined ? { password: input.password } : {}),
    ...(input.token !== undefined ? { token: input.token } : {}),
  };
  const encrypted = encryptCredential(input.platform, JSON.stringify(credential));
  await prisma.platformIntegration.upsert({
    where: { orgId_platform: { orgId, platform: input.platform } },
    create: { orgId, platform: input.platform, address: input.address, authType, credential: encrypted },
    update: { address: input.address, authType, credential: encrypted, testStatus: "NONE", testedAt: null },
  });
}

export async function deleteIntegration(orgId: string, platform: string): Promise<void> {
  const r = await prisma.platformIntegration.findUnique({ where: { orgId_platform: { orgId, platform } } });
  if (!r) throw new DomainError(ErrCode.INTEGRATION_NOT_FOUND, "该平台未配置集成");
  const refs = await prisma.platformSyncConfig.count({ where: { platform } });
  if (refs > 0) {
    throw new DomainError(ErrCode.PLATFORM_SYNC_CONFIG_INVALID, `存在 ${refs} 个项目关联该平台，请先解除`);
  }
  await prisma.platformIntegration.delete({ where: { id: r.id } });
}

/** 测试连接（经 runner 平台插件；成功回填账号展示名） */
export async function testConnection(orgId: string, platform: string): Promise<{ account?: string; email?: string }> {
  const row = await prisma.platformIntegration.findUnique({ where: { orgId_platform: { orgId, platform } } });
  if (!row) throw new DomainError(ErrCode.INTEGRATION_NOT_FOUND, "该平台未配置集成");
  const pluginId = await enabledPlatformPluginId(platform);
  let status = "OK";
  let message: string | null = null;
  let account: { account?: string; email?: string } = {};
  try {
    account = await runnerCall<{ account?: string; email?: string }>(pluginId, "testConnection", [toConfig(row)]);
  } catch (err) {
    status = "FAILED";
    message = err instanceof Error ? err.message : String(err);
    const unauthorized = message.includes("PLATFORM_UNAUTHORIZED");
    await prisma.platformIntegration.update({
      where: { id: row.id },
      data: { testStatus: status, testMessage: message.slice(0, 512), testedAt: new Date() },
    });
    throw new DomainError(
      unauthorized ? ErrCode.PLATFORM_UNAUTHORIZED : ErrCode.INTEGRATION_CONNECT_FAILED,
      message,
    );
  }
  await prisma.platformIntegration.update({
    where: { id: row.id },
    data: {
      testStatus: status,
      testMessage: account.account ? `连接成功：${account.account}` : "连接成功",
      testedAt: new Date(),
    },
  });
  return account;
}

/** 项目同步编排读取组织集成配置（INTG-001 §2 配置层级） */
export async function requireIntegration(orgId: string, platform: string) {
  const row = await prisma.platformIntegration.findUnique({ where: { orgId_platform: { orgId, platform } } });
  if (!row) throw new DomainError(ErrCode.PLATFORM_SYNC_CONFIG_INVALID, `组织未配置 ${platform} 服务集成`);
  return { row, config: toConfig(row) };
}
