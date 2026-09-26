/**
 * 附件存储抽象（BUG-001）：本地磁盘驱动（HMAC 令牌读）。
 * 勘误登记：基线口径为 MinIO 预签名 URL；MinIO 镜像源修复前（INFRA-002 勘误）以本地驱动落地，
 * 接口保持 storageKey 抽象，Sprint 2 文件管理接入 MinIO 时替换驱动即可。
 */
import { createHmac, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '@rabbit/shared';

const ROOT = process.env.ATTACHMENT_DIR ?? path.join(process.cwd(), 'data', 'attachments');

/** 可执行文件等危险类型拒收（rules/security.md 附件黑名单）。 */
const BLOCKED_EXTS = ['.exe', '.bat', '.cmd', '.sh', '.com', '.msi', '.app', '.deb', '.rpm', '.jar', '.dll', '.so', '.bin'];

export function isBlockedName(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return BLOCKED_EXTS.includes(ext);
}

export async function putObject(buffer: Buffer): Promise<string> {
  const key = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}`;
  const abs = path.join(ROOT, key);
  mkdirSync(path.dirname(abs), { recursive: true });
  await writeFile(abs, buffer);
  return key;
}

export function objectStream(key: string): NodeJS.ReadableStream {
  return createReadStream(path.join(ROOT, key));
}

export async function readObject(key: string): Promise<Buffer> {
  return readFile(path.join(ROOT, key));
}

export async function deleteObject(key: string): Promise<void> {
  const abs = path.join(ROOT, key);
  if (existsSync(abs)) await rm(abs, { force: true });
}

/** 下载令牌（本地驱动的「预签名」等价物：限时 HMAC）。 */
export function signDownloadToken(objectId: string, ttlMs = 10 * 60_000): string {
  const exp = Date.now() + ttlMs;
  const sig = createHmac('sha256', `${config.sessionSecret}:dl`).update(`${objectId}.${exp}`).digest('base64url');
  return `${exp}.${sig}`;
}

export function verifyDownloadToken(objectId: string, token: string): boolean {
  const [expRaw, sig] = token.split('.');
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expect = createHmac('sha256', `${config.sessionSecret}:dl`).update(`${objectId}.${exp}`).digest('base64url');
  return expect === sig;
}
