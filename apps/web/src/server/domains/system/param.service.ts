/** SYS-005：系统参数（基础/SMTP/文件/数据清理）——站点 URL、SMTP 测试连接、附件上限、保留时长。 */
import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { DomainError, ErrCode, config } from '@rabbit/shared';
import { prisma } from '@rabbit/db';
import type { Prisma } from '@rabbit/db';

const toJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v ?? {})) as Prisma.InputJsonValue;

const DEFAULTS = {
  base: { siteUrl: 'http://localhost:3000', loginBanner: '' },
  smtp: { host: '', port: 465, user: '', pass: '', ssl: true, from: '' },
  file: { maxSizeMb: 50 },
  cleanup: { logRetentionDays: 90, changeLogRetentionDays: 90, lastRunAt: null as string | null, lastRunCount: 0 },
} as const;

/** SMTP 密码 AES-256-GCM 加密（rules/security：密钥不出现在源码/日志）。 */
function paramKey(): Buffer {
  return createHash('sha256').update(`${config.sessionSecret}:param`).digest();
}

function encryptSecret(plain: string): string {
  const iv = createHash('md5').update(`iv:${plain.length}:${Date.now()}`).digest().subarray(0, 12);
  const cipher = createCipheriv('aes-256-gcm', paramKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `enc:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

function decryptSecret(stored: string): string | null {
  if (!stored.startsWith('enc:')) return null;
  try {
    const parts = stored.split(':');
    const ivB64 = parts[1] ?? '';
    const tagB64 = parts[2] ?? '';
    const dataB64 = parts[3] ?? '';
    const decipher = createDecipheriv('aes-256-gcm', paramKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export async function readParam<K extends keyof typeof DEFAULTS>(group: K): Promise<Record<string, unknown>> {
  const row = await prisma.systemParam.findUnique({ where: { key: group } });
  const value = (row?.value ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...(DEFAULTS[group] as Record<string, unknown>), ...value };
  if (group === 'smtp' && typeof merged.pass === 'string' && merged.pass) {
    merged.pass = decryptSecret(merged.pass) ?? '******'; // 无法解密则视为已脱敏
  }
  return merged;
}

/** 全量读取（SMTP 密码脱敏为 ******）。 */
export async function getParams() {
  const [base, smtp, file, cleanup] = await Promise.all([
    readParam('base'), readParam('smtp'), readParam('file'), readParam('cleanup'),
  ]);
  return {
    base,
    smtp: { ...smtp, pass: smtp.pass ? '******' : '' },
    file,
    cleanup,
  };
}

export async function updateParam(
  group: 'basic' | 'smtp' | 'file' | 'cleanup',
  value: Record<string, unknown>,
): Promise<void> {
  let stored: Record<string, unknown> = { ...value };
  if (group === 'smtp') {
    // 密码为 ****** 表示未修改，保留原值
    const prev = await readParam('smtp');
    const prevRow = await prisma.systemParam.findUnique({ where: { key: 'smtp' } });
    const prevRawPass = ((prevRow?.value ?? {}) as Record<string, unknown>).pass;
    const pass = value.pass;
    if (pass === '******' || pass === '') {
      stored.pass = prevRawPass ?? '';
    } else {
      stored.pass = encryptSecret(String(pass));
    }
    void prev;
  }
  if (group === 'cleanup') {
    const days = Number(value.logRetentionDays);
    const changeDays = Number(value.changeLogRetentionDays);
    if (!(days >= 7) || !(changeDays >= 7)) {
      throw new DomainError(ErrCode.VALIDATION_FAILED, '保留天数下限为 7 天（防误配全清）');
    }
    // 保留上次运行信息
    const prev = await readParam('cleanup');
    stored = { ...value, lastRunAt: prev.lastRunAt, lastRunCount: prev.lastRunCount };
  }
  await prisma.systemParam.upsert({
    where: { key: group === 'basic' ? 'base' : group },
    update: { value: toJson(stored) },
    create: { key: group === 'basic' ? 'base' : group, value: toJson(stored) },
  });
}

/** SMTP 测试连接：nodemailer verify()，结果与错误明细回显（不落历史）。 */
export async function testSmtp(input: { host: string; port: number; user: string; pass: string; ssl: boolean; from: string }) {
  const { createTransport } = await import('nodemailer');
  const pass = input.pass === '******' ? String((await readParam('smtp')).pass ?? '') : input.pass;
  const transport = createTransport({
    host: input.host,
    port: input.port,
    secure: input.ssl,
    auth: input.user ? { user: input.user, pass } : undefined,
    connectionTimeout: 8000,
  });
  try {
    await transport.verify();
    return { ok: true, message: '连接成功' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  } finally {
    transport.close();
  }
}

/** 附件大小上限（MB）——BUG-001 等上传统一读取。 */
export async function fileMaxSizeMb(): Promise<number> {
  const file = await readParam('file');
  return Number(file.maxSizeMb) || 50;
}

export async function siteUrl(): Promise<string> {
  const base = await readParam('base');
  return String(base.siteUrl || 'http://localhost:3000');
}

export { encryptSecret, decryptSecret };
