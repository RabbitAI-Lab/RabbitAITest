/**
 * OAuth Token 通道（SYS-009 §4.4）：Device Flow 发码/批准/交换、refresh 旋转与重放检测、
 * 授权会话管理。token 仅存 sha256（hex）；随机/哈希常量时间比对口径对齐 apikey.service。
 * device/code 与 token 端点的 RFC 8628 原生形状在 route 层组装（api-conventions 例外登记）。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DomainError, ErrCode, ErrMsg } from "@rabbit/shared";
import {
  ACCESS_TOKEN_PREFIX,
  OAUTH_ACCESS_TTL,
  OAUTH_CLIENT_ID,
  OAUTH_DEVICE_CODE_TTL,
  OAUTH_POLL_INTERVAL,
  OAUTH_REFRESH_TTL,
  REFRESH_TOKEN_PREFIX,
  USER_CODE_CHARSET,
  normalizeUserCode,
  parseScope,
  type OAuthScope,
} from "@rabbit/shared";
import { prisma } from "@rabbit/db";

const MAX_APPROVE_FAILS = 5; // 批准页错码锁定阈值（route 层 10 分钟窗口计数）
export { MAX_APPROVE_FAILS };

function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function genToken(prefix: string): string {
  return prefix + randomBytes(32).toString("base64url");
}

/** 常量时间哈希比对（长度不等直接 false，不因长度泄漏）。 */
function hashEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function genUserCode(): string {
  let code = "";
  const bytes = randomBytes(8);
  for (let i = 0; i < 8; i++)
    code += USER_CODE_CHARSET.charAt(bytes[i]! % USER_CODE_CHARSET.length);
  return code;
}

export function formatUserCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** IPv4 保留 /24 尾段、IPv6 保留前两组（授权会话列表脱敏展示）。 */
export function maskIp(ip: string | null): string | null {
  if (!ip) return null;
  if (ip.includes(":")) {
    return `${ip.split(":")[0]}:∗`;
  }
  const segs = ip.split(".");
  if (segs.length === 4) return `${segs.slice(0, 3).join(".")}.∗`;
  return "∗";
}

// ── Device Flow：发码 ──

export interface DeviceCodeIssued {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export async function issueDeviceCode(input: {
  clientId?: string;
  scope?: string;
  deviceName?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  origin: string;
}): Promise<DeviceCodeIssued> {
  const scopes = parseScope(input.scope);
  if (!scopes) throw new DomainError(ErrCode.OAUTH_USER_CODE_INVALID, "invalid_scope");
  const clientId = input.clientId?.trim() || OAUTH_CLIENT_ID;
  const deviceCode = genToken("rdc_");
  // user_code 撞上在途 PENDING 则重生成（防同码双义）
  let userCode = genUserCode();
  for (let i = 0; i < 3; i++) {
    const dup = await prisma.oAuthDeviceCode.findFirst({
      where: { userCode, status: "PENDING", expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!dup) break;
    userCode = genUserCode();
  }
  await prisma.oAuthDeviceCode.create({
    data: {
      clientId,
      deviceCodeHash: sha256Hex(deviceCode),
      userCode,
      scope: scopes.join(","),
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 256) ?? null,
      expiresAt: new Date(Date.now() + OAUTH_DEVICE_CODE_TTL * 1000),
    },
  });
  const uri = `${input.origin}/oauth/device`;
  return {
    device_code: deviceCode,
    user_code: formatUserCode(userCode),
    verification_uri: uri,
    verification_uri_complete: `${uri}?code=${formatUserCode(userCode)}`,
    expires_in: OAUTH_DEVICE_CODE_TTL,
    interval: OAUTH_POLL_INTERVAL,
  };
}

// ── Device Flow：批准（确认页回显 + 提交） ──

export interface PendingDeviceRequest {
  clientId: string;
  scope: OAuthScope[];
  ip: string | null;
  createdAt: string;
  expiresAt: string;
}

/** 确认页回显：PENDING 且未过期的待授权请求（输码后「校验」步）。 */
export async function lookupPendingByUserCode(raw: string): Promise<PendingDeviceRequest | null> {
  const row = await findPending(normalizeUserCode(raw));
  if (!row) return null;
  return {
    clientId: row.clientId,
    scope: row.scope.split(",") as OAuthScope[],
    ip: maskIp(row.ip),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

async function findPending(normalized: string) {
  if (normalized.length !== 8) return null;
  return prisma.oAuthDeviceCode.findFirst({
    where: { userCode: normalized, status: "PENDING", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
}

/** 批准/拒绝（session 本人）；无效/过期 → 422 10030。错码锁定（≥5 次/10 分钟，用户维度）由 route 层计数。 */
export async function approveDeviceCode(
  raw: string,
  userId: string,
  approve: boolean,
): Promise<void> {
  const row = await findPending(normalizeUserCode(raw));
  if (!row)
    throw new DomainError(
      ErrCode.OAUTH_USER_CODE_INVALID,
      ErrMsg[ErrCode.OAUTH_USER_CODE_INVALID]!,
    );
  await prisma.oAuthDeviceCode.update({
    where: { id: row.id },
    data: approve
      ? { status: "APPROVED", userId, approvedAt: new Date() }
      : { status: "DENIED", userId },
  });
}

// ── Device Flow：device_code 换 token（轮询端点） ──

export type TokenExchange =
  | { kind: "pending" }
  | { kind: "denied" }
  | { kind: "expired" }
  | {
      kind: "issued";
      userId: string;
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
    };

export async function exchangeDeviceToken(deviceCode: string): Promise<TokenExchange> {
  const row = await prisma.oAuthDeviceCode.findFirst({
    where: { deviceCodeHash: sha256Hex(deviceCode) },
  });
  if (!row || row.status === "CONSUMED" || row.expiresAt.getTime() <= Date.now()) {
    return { kind: "expired" };
  }
  if (row.status === "DENIED") return { kind: "denied" };
  if (row.status === "PENDING") return { kind: "pending" };
  // APPROVED → 原子消费（条件更新防双花；竞争失败方按 pending 再轮询）
  const consumed = await prisma.oAuthDeviceCode.updateMany({
    where: { id: row.id, status: "APPROVED" },
    data: { status: "CONSUMED" },
  });
  if (consumed.count !== 1) return { kind: "pending" };
  const issued = await issueGrant({
    userId: row.userId!,
    clientId: row.clientId,
    scope: row.scope,
    ip: row.ip,
  });
  return { kind: "issued", userId: row.userId!, ...issued, scope: row.scope };
}

// ── refresh 旋转（含重放检测：旧 refresh 复用 → 整授权会话吊销） ──

export async function refreshGrant(refreshToken: string): Promise<
  | { kind: "invalid" }
  | {
      kind: "issued";
      userId: string;
      grantId: string;
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
    }
> {
  if (!refreshToken.startsWith(REFRESH_TOKEN_PREFIX)) return { kind: "invalid" };
  const hash = sha256Hex(refreshToken);
  const grant = await prisma.oAuthGrant.findFirst({ where: { refreshTokenHash: hash } });
  if (grant) {
    const alive =
      grant.status === "ACTIVE" &&
      grant.refreshExpiresAt &&
      grant.refreshExpiresAt.getTime() > Date.now();
    if (!alive) return { kind: "invalid" };
    const issued = await issueGrantTokens();
    await prisma.oAuthGrant.update({
      where: { id: grant.id },
      data: {
        prevRefreshHash: grant.refreshTokenHash,
        refreshTokenHash: sha256Hex(issued.refresh_token),
        refreshExpiresAt: new Date(Date.now() + OAUTH_REFRESH_TTL * 1000),
        accessTokenHash: sha256Hex(issued.access_token),
        accessExpiresAt: new Date(Date.now() + OAUTH_ACCESS_TTL * 1000),
        rotatedAt: new Date(),
      },
    });
    return {
      kind: "issued",
      userId: grant.userId,
      grantId: grant.id,
      ...issued,
      scope: grant.scope,
    };
  }
  // 未命中当前值 → 查已旋转旧值：命中即重放，吊销整个授权会话（token family）
  const replayed = await prisma.oAuthGrant.findFirst({
    where: { prevRefreshHash: hash, status: "ACTIVE" },
  });
  if (replayed) {
    await prisma.oAuthGrant.update({
      where: { id: replayed.id },
      data: { status: "REVOKED", revokedAt: new Date(), refreshTokenHash: null },
    });
  }
  return { kind: "invalid" };
}

// ── 认证协商（current-user 调用） ──

export interface VerifiedToken {
  userId: string;
  scope: OAuthScope[];
}

/** Bearer access token 校验：ACTIVE + 未过期 + 用户 ACTIVE 未删（与 session 同语义）。 */
export async function verifyAccessToken(token: string): Promise<VerifiedToken | null> {
  if (!token.startsWith(ACCESS_TOKEN_PREFIX)) return null;
  const grant = await prisma.oAuthGrant.findFirst({
    where: { accessTokenHash: sha256Hex(token), status: "ACTIVE" },
  });
  if (!grant || grant.accessExpiresAt.getTime() <= Date.now()) return null;
  const user = await prisma.user.findFirst({
    where: { id: grant.userId, status: "ACTIVE", deletedAt: null },
    select: { id: true },
  });
  if (!user) return null;
  void prisma.oAuthGrant
    .update({ where: { id: grant.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
  return { userId: grant.userId, scope: grant.scope.split(",") as OAuthScope[] };
}

// ── 授权会话管理 ──

export async function revokeByAccessToken(token: string): Promise<boolean> {
  const res = await prisma.oAuthGrant.updateMany({
    where: { accessTokenHash: sha256Hex(token), status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date(), refreshTokenHash: null },
  });
  return res.count > 0;
}

export async function listGrants(userId: string) {
  const rows = await prisma.oAuthGrant.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    deviceName: r.deviceName,
    scope: r.scope.split(","),
    ip: maskIp(r.ip),
    status: r.status,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    accessExpiresAt: r.accessExpiresAt.toISOString(),
    refreshExpiresAt: r.refreshExpiresAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    revokedAt: r.revokedAt?.toISOString() ?? null,
  }));
}

export async function revokeGrant(userId: string, grantId: string): Promise<void> {
  const row = await prisma.oAuthGrant.findFirst({ where: { id: grantId, userId } });
  if (!row)
    throw new DomainError(ErrCode.OAUTH_GRANT_NOT_FOUND, ErrMsg[ErrCode.OAUTH_GRANT_NOT_FOUND]!);
  await prisma.oAuthGrant.update({
    where: { id: grantId },
    data: { status: "REVOKED", revokedAt: new Date(), refreshTokenHash: null },
  });
}

// ── 内部 ──

async function issueGrant(input: {
  userId: string;
  clientId: string;
  scope: string;
  ip: string | null;
}) {
  const issued = await issueGrantTokens();
  await prisma.oAuthGrant.create({
    data: {
      userId: input.userId,
      clientId: input.clientId,
      scope: input.scope,
      status: "ACTIVE",
      accessTokenHash: sha256Hex(issued.access_token),
      accessExpiresAt: new Date(Date.now() + OAUTH_ACCESS_TTL * 1000),
      refreshTokenHash: sha256Hex(issued.refresh_token),
      refreshExpiresAt: new Date(Date.now() + OAUTH_REFRESH_TTL * 1000),
      ip: input.ip,
    },
  });
  return issued;
}

function issueGrantTokens(): { access_token: string; refresh_token: string; expires_in: number } {
  return {
    access_token: genToken(ACCESS_TOKEN_PREFIX),
    refresh_token: genToken(REFRESH_TOKEN_PREFIX),
    expires_in: OAUTH_ACCESS_TTL,
  };
}

export { sha256Hex, hashEquals };
