/**
 * 个人 APIKEY（INTG-003 §2）：生成（ak/sk 一次性返回，库存 sha256）/列表/吊销（≤5 条）+ 认证校验。
 * 认证形态：Authorization Basic base64(ak:sk) 或 Bearer ak.sk。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DomainError, ErrCode } from "@rabbit/shared";
import { prisma } from "@rabbit/db";

const MAX_KEYS = 5;
const AK_PREFIX = "rak";

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url").replace(/[-_]/g, "").slice(0, bytes);
}

function hashKey(accessKey: string, secretKey: string): string {
  return createHash("sha256").update(`${accessKey}:${secretKey}`).digest("hex");
}

export async function listApiKeys(userId: string) {
  const rows = await prisma.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    revokedAt: r.revokedAt?.toISOString() ?? null,
  }));
}

export async function createApiKey(userId: string, name: string) {
  const count = await prisma.apiKey.count({ where: { userId, revokedAt: null } });
  if (count >= MAX_KEYS) {
    throw new DomainError(ErrCode.APIKEY_LIMIT_EXCEEDED, `APIKEY 上限 ${MAX_KEYS} 条（当前 ${count}）`);
  }
  const accessKey = AK_PREFIX + randomToken(20);
  const secretKey = "sk_" + randomToken(40);
  const row = await prisma.apiKey.create({
    data: { userId, name, prefix: accessKey.slice(0, 8), keyHash: hashKey(accessKey, secretKey) },
  });
  return {
    id: row.id,
    name,
    prefix: row.prefix,
    lastUsedAt: null,
    createdAt: row.createdAt.toISOString(),
    revokedAt: null,
    accessKey,
    secretKey, // 仅此一次返回（INTG-003 §1.2）
  };
}

export async function revokeApiKey(userId: string, id: string): Promise<void> {
  const row = await prisma.apiKey.findFirst({ where: { id, userId } });
  if (!row || row.revokedAt) throw new DomainError(ErrCode.APIKEY_INVALID, "APIKEY 不存在或已吊销");
  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
}

/** 认证校验（常量时间比对）：返回 userId；无效抛 10010 */
export async function verifyApiKey(accessKey: string, secretKey: string): Promise<string> {
  if (!accessKey.startsWith(AK_PREFIX) || !secretKey) {
    throw new DomainError(ErrCode.APIKEY_INVALID, "APIKEY 格式非法");
  }
  const prefix = accessKey.slice(0, 8);
  const candidates = await prisma.apiKey.findMany({ where: { prefix, revokedAt: null } });
  const expected = Buffer.from(hashKey(accessKey, secretKey), "hex");
  for (const c of candidates) {
    const actual = Buffer.from(c.keyHash, "hex");
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
      await prisma.apiKey.update({ where: { id: c.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
      return c.userId;
    }
  }
  throw new DomainError(ErrCode.APIKEY_INVALID, "APIKEY 无效或已吊销");
}

/** 解析 Authorization 头 → {ak, sk}（Basic 优先，其次 Bearer ak.sk） */
export function parseAuthHeader(header: string | null): { accessKey: string; secretKey: string } | null {
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (scheme === "Basic" && value) {
    try {
      const decoded = Buffer.from(value, "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx <= 0) return null;
      return { accessKey: decoded.slice(0, idx), secretKey: decoded.slice(idx + 1) };
    } catch {
      return null;
    }
  }
  if (scheme === "Bearer" && value) {
    const idx = value.indexOf(".");
    if (idx <= 0) return null;
    return { accessKey: value.slice(0, idx), secretKey: value.slice(idx + 1) };
  }
  return null;
}
